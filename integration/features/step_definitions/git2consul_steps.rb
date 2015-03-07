require 'rspec'
require 'net/http'
require 'uri'
require 'open3'

RSpec.configure {|c| c.fail_fast = true}

def run_command(cmd)
  Open3.popen3(cmd) do |stdin, stdout, stderr, thread|
    stdout.read
  end
end

def write_file(path, body)
  File.open(path, 'w') { |file| file.write(body) }
end

Given /The git integration repo is initialized/ do
  FileUtils.rm_rf 'integration_test_repo'
  Dir.mkdir 'integration_test_repo'
  Dir.chdir 'integration_test_repo' do
    system("git init")
    ['dev','test','prod'].each { |env|
      system("git checkout -b #{env}")
      write_file("readme.md", "#{env} readme")
      system("git add readme.md")
      system("git commit -m \"Initial commit to #{env}\"")
    }
  end
end

Given /The (.*) box is online/ do |server|
  system("vagrant up #{server}")
  #system("vagrant provision #{server}")
end

Then /The (.*) box has a git2consul config/ do |server|
  req = Net::HTTP::Put.new('/v1/kv/git2consul/config', initheader = { 'Content-Type' => 'application/json'})
  req.body = File.open("config.json", "rb").read
  puts "Sending #{req.body} to #{server}"
  response = Net::HTTP.new(server, 8500).start {|http| http.request(req) }
  puts response.code
end

Then /The (.*) box is running git2consul/ do |box_name|
  run_command("vagrant ssh -c \"sudo service git2consul stop ; sudo rm -rf /tmp/git_cache && sudo service git2consul start\" #{box_name}")
  out = run_command("vagrant ssh -c \"service git2consul status\" #{box_name}")
  expect(out).to include("running")
end

Then /The (.*) box has 2 known peers/ do |server|
  out = run_command("vagrant ssh -c \"consul info\" #{server}")
  expect(out).to include("num_peers = 2")
end