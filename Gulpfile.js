'use strict';

const gulp = require('gulp');
const child_process = require('child_process');
const fs = require('graceful-fs');
const mergeStream = require('merge-stream');
const git = require('gulp-git');
const replaceStream = require('replacestream');
const log = require('gulplog');
const troxel = require('Troxel');
const readline = require('readline');
const join = require('path').join;
const del = require('del');
const crypto = require('crypto');
const stringify = require('json-stable-stringify');
const async = require('async');

let trovedir, devtool, repo;
let models = {};
let changedFiles = [];
if (process.platform === 'darwin') {
  trovedir = '/Applications/Trion Games/Trove-Live.app/Contents/Resources/Trove.app/Contents/Resources';
  devtool = '../MacOS/Trove';
}
else {
  trovedir = 'C:\\Program Files (x86)\\Glyph\\Games\\Trove\\Live';
  devtool = 'Trove.exe';
}

function testAndChdirTrovedir(cb){
  fs.access(join(trovedir, devtool), fs.R_OK, function(err) {
    var rl;
    if (err != null) {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      log.info("Warning: Can't find the Trove executable. Please enter the path to Trove's 'Live' directory " + "(defaults to C:\\Program Files (x86)\\Glyph\\Games\\Trove\\Live) or leave it empty to abort!");
      rl.question(">> Path to Trove's Live directory: ", function(path) {
        if (path === '') {
          return rl.emit('SIGINT');
        }
        trovedir = path;
        rl.close();
        testAndChdirTrovedir(cb);
      });
      rl.on('SIGINT', function() {
        rl.close();
        cb(new Error("Skipped importing Trove blueprints because of no Trove directory specified."));
      });
    } else {
      repo = process.cwd();
      process.chdir(trovedir);
      cb();
    }
  });
}

function setup(){
  log.info('cleaning and setting up import environment (could take a minute)...');
  let promises = [];
  promises.push(new Promise(function(resolve, reject){ // create qbexport if not existing
    fs.stat('qbexport', function(err, stats) {
      if (err != null) {
        if (err.code !== 'ENOENT') return reject(err);
        fs.mkdir('qbexport', 0x1ed, (err) => {
          if (err) return reject(err);
          resolve();
        });
      } else {
        if (!stats.isDirectory()) return reject(new Error("qbexport is not a directory"));
        resolve();
      }
    });
  }));
  let dirs = ['bpexport/*', 'qbexport/*']
  if (process.platform === 'darwin'){
    dirs.push(join(process.env.HOME, 'Documents/Trion Worlds/Trove/DevTool.log'));
    promises.push(new Promise(function(resolve, reject){ // fix devtool permissions on OS X
      fs.chmod('../MacOS/Trove', 0x1e4, (err) => {
        if (err) return reject(err);
        resolve();
      });
    }));
  }
  else {
    dirs.push('%appdata%\\Trove\\DevTool.log');
  }
  promises.push(del(dirs)); // clean bpexport and qbexport
  return Promise.all(promises);
}

function extractBlueprints(){
  log.info('extracting 2 blueprint archives (could take a minute)...');
  let promises = [];
  for (let archive of ['blueprints/equipment/ring', 'blueprints']){
    promises.push(new Promise(function(resolve, reject){
      child_process.execFile(devtool, ['-tool', 'extractarchive', archive, 'bpexport'], {timeout: 60000}, (err, stdout, stderr) => {
        if ((err != null) && (err.killed || (err.signal != null) || err.code !== 1)) { // ignore devtool error code 1
          log.info(`failed to extract archive: ${archive}`);
          return reject(err);
        }
        log.info(`archive ${archive} sucessfully extracted!`);
        resolve();
      });
    }));
  }
  return Promise.all(promises);
}

function getChangedBps(){
  return new Promise(function(resolve, reject){
    fs.readdir('bpexport', (err, bps) => {
      if (err) return reject(err);
      resolve(bps);
    });
  }).then(function(bps){
    log.info(`comparing sha256 hashes of ${bps.length} blueprints to determine changed ones...`);
    let oldSha256 = require(`${repo}/Trove_sha256.json`);
    let oldModels = require(`${repo}/Trove.json`)
    let newSha256 = {};
    let promises = [];
    for (let f of bps){
      if (f.length > 10 && f.indexOf('.blueprint') === f.length - 10) {
        promises.push(new Promise(function(resolve, reject){
          fs.readFile(`bpexport/${f}`, (err, data) => {
            if (err) return reject(err);
            newSha256[f] = crypto.createHash('sha256').update(data).digest('hex');
            let exp = f.substring(0, f.length - 10);
            if ((oldSha256[f] != null) && oldSha256[f] === newSha256[f] && (oldModels[exp] != null)) {
              models[exp] = oldModels[exp];
            } else {
              changedFiles.push(f);
            }
            resolve();
          });
        }));
      }
    }
    return Promise.all(promises).then(function(){
      log.info(`found ${changedFiles.length} new or updated blueprints for reimport`);
      return new Promise(function(resolve, reject){
        fs.writeFile(`${repo}/Trove_sha256.json`, stringify(newSha256, {space: '  '}), (err) => {
          if (err) return reject(err);
          log.info(`sha256 data of ${Object.keys(newSha256).length} blueprints successfully written to ${repo}/Trove_sha256.json`);
          resolve();
        });
      });
    });
  });
}

function importBps(callback){
  let toProcess = changedFiles.length;
  let totalBps = toProcess;
  let failedBlueprints = [];
  const clog = console.log;
  troxel.TestUtils();
  let isTTY = process.stdout.isTTY;
  let cursor = require('ansi')(process.stdout);
  let barWidth = process.stdout.getWindowSize()[0] - 17;
  cursor.write('\n\n');
  let processedOne = function(msg, err, warn) {
    toProcess--;
    if (isTTY && !warn) {
      cursor.up(1).horizontalAbsolute(0).eraseLine();
    }
    if (err){
      cursor.bg.red().write(msg).bg.reset().write('\n');
    }
    else {
      cursor.write(msg + '\n');
    }
    if (isTTY) {
      let s = Math.round(toProcess / totalBps * barWidth);
      cursor.write(`╢${Array(barWidth - s).join('█')}${Array(s).join('░')}╟ ${toProcess} bp left\n`);
    }
  };
  const queue = async.queue((f, cb) => {
    let exp = f.substring(0, f.length - 10);
    child_process.execFile(devtool, ['-tool', 'copyblueprint', '-generatemaps', '1', `bpexport/${f}`, `qbexport/${exp}.qb`], {timeout: 15000}, (err, stdout, stderr) => {
      if ((err != null) && (err.killed || (err.signal != null) || err.code !== 1)) { // ignore devtool error code 1
        failedBlueprints.push(f);
        processedOne("skipped (devtool not responding): " + f, true, false);
        return cb();
      }
      let qbf = 'qbexport/' + exp;
      let io = new troxel.QubicleIO({m: qbf + '.qb', a: qbf + '_a.qb', t: qbf + '_t.qb', s: qbf + '_s.qb'}, () => {
        let bb = io.computeBoundingBox();
        io.resize(bb[0], bb[1], bb[2], bb[3], bb[4], bb[5]);
        models[exp] = new troxel.Base64IO(io)["export"](true, 2);
        processedOne("imported: " + f, false, io.warn.length > 0);
        if (toProcess === 0) queue.drain();
      });
      cb(); // opening qb files can run concurrent to devtool tasks
    });
  }, 2 * require('os').cpus().length);
  queue.drain = function() {
    if (toProcess !== 0) return;
    if (failedBlueprints.length > 0) {
      cursor.write(`retrying ${failedBlueprints.length} broken blueprints in series\n`);
      toProcess = totalBps = failedBlueprints.length;
      failedBlueprints = [];
      queue.concurrency = 1;
      return queue.push(failedBlueprints);
    }
    cursor.write('\n');
    fs.writeFile(`${repo}/Trove.json`, stringify(models, {space: '  '}), (err) => {
      if (err) return callback(err);
      log.info(`base64 data of ${Object.keys(models).length} (${changedFiles.length} new) blueprints successfully written to ${repo}/Trove.json`);
      callback();
    });
    console.log = clog;
  };
  queue.push(changedFiles);
}

function cleanup(){
  log.info('cleaning up (could take a minute)...');
  return del(['bpexport/*', 'qbexport/*']).then(() => process.chdir(repo));
}

gulp.task('default', gulp.series(testAndChdirTrovedir, setup, extractBlueprints, getChangedBps, importBps, cleanup));

// rebasing git tags

let git_tags;

function getGitTags(cb){
  child_process.exec('git tag | sort -r', (err, stdout, stderr) => {
    git_tags = stdout.trim().split('\n');
    cb(err);
  });
}

function rebaseGitTags(){
  let promises = [];
  for (let tag of git_tags){
    promises.push(new Promise(function(resolve, reject){
      child_process.execFile('git', ['log', '-1', '--pretty=format:%H\n%s', tag], (err, stdout, stderr) => {
        if (err) return reject(err);
        let tag_data = stdout.trim().split('\n');
        child_process.exec(`git log --pretty="%H|||%s" master | grep "${tag_data[1]}"`, (err, stdout, stderr) => {
          if (err) return reject(err);
          let commit_data = stdout.trim().split('|||');
          if (commit_data[0] === tag_data[0]){
            console.log(`tag ${tag} needs no rebase`);
            resolve();
          }
          else {
            child_process.execFile('git', ['tag', '--force', tag, commit_data[0]], (err, stdout, stderr) => {
              if (err) return reject(err);
              console.log(`tag ${tag} sucessfully rebased from ${tag_data[0]} to ${commit_data[0]}`);
              resolve();
            });
          }
        });
      });
    }));
  }
  return Promise.all(promises);
}

gulp.task('rebaseTags', gulp.series(getGitTags, rebaseGitTags));

// Build git tag based JSON directory

function mkDist(cb){
  fs.mkdir('dist', cb);
}

function buildIndex(cb){
  let index = {
    version: [1, 0],
    latest: process.env.TRAVIS_TAG,
    tags: git_tags
  };
  fs.writeFile('dist/index.json', JSON.stringify(index), cb);
}

function buildTagsJSON(){
  let merged = mergeStream();
  for (let tag of git_tags){
    const gs = child_process.spawn('git', ['show', `${tag}:Trove.json`]);
    gs.stdout.pipe(replaceStream(/\s/g, '')).pipe(fs.createWriteStream(`dist/${tag}.json`));
    merged.add(gs.stdout);
  }
  return merged;
}

gulp.task('build', gulp.series(gulp.parallel(getGitTags, mkDist), gulp.parallel(buildIndex, buildTagsJSON)));

// Deploy JSON files to Github Pages

function gitInit(cb){
  git.init({cwd: 'dist'}, cb);
}

function gitCommit(){
  return gulp.src('dist/.')
    .pipe(git.add({cwd: 'dist'}))
    .pipe(git.commit('deploy JSON files to GitHub Pages', {cwd: 'dist'}));
}

function gitPush(cb){
  let origin = `https://${process.env.GH_TOKEN}@github.com/troxeljs/trove-blueprints.git`;
  git.push(origin, 'master:gh-pages', {args: '--force --quiet', cwd: 'dist', quiet: true}, cb);
}

gulp.task('deploy', gulp.series(gitInit, gitCommit, gitPush));
