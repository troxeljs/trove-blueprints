'use strict';

const gulp = require('gulp');
const log = require('gulplog');
const Promise = require('bluebird');
Promise.config({longStackTraces: true, warnings: true});
const fs = Promise.promisifyAll(require('graceful-fs'));
const child_process = Promise.promisifyAll(require('child_process'));

const del = require('del');
const stringify = require('json-stable-stringify');

const git = require('gulp-git');

let trovedir, devtool, repo;
let models = {};
let modelAPs = {};
let changedFiles = [];
let brokenBps = {warn: [], err: []};
if (process.platform === 'darwin') {
  trovedir = '/Applications/Trion Games/Trove-Live.app/Contents/Resources/Trove.app/Contents/Resources';
  devtool = '../MacOS/Trove';
}
else {
  trovedir = 'C:\\Program Files (x86)\\Glyph\\Games\\Trove\\Live';
  devtool = 'Trove.exe';
}
const argv = require('minimist')(process.argv.slice(2)); // gulp --trovedir="<path to Trove>" -ewa to reimpoirt errored / warned / all bps
if (argv.trovedir) trovedir = argv.trovedir;
const jobs = argv.j || 2 * require('os').cpus().length;

let rl;
let join;
function setup(){
  join = join || require('path').join;
  return fs.accessAsync(join(trovedir, devtool), fs.R_OK).then(() => {
    repo = process.cwd();
    process.chdir(trovedir);
    if (rl !== undefined) rl.close();
    return false;
  }).catch(() => {
    if (rl === undefined){
      let readline = require('readline');
      rl = readline.createInterface({input: process.stdin, output: process.stdout});
    }
    log.info("Warning: Can't find the Trove executable. Please enter the path to Trove's 'Live' directory " + "(defaults to C:\\Program Files (x86)\\Glyph\\Games\\Trove\\Live) or leave it empty to abort!");
    return new Promise(function(resolve, reject){
      rl.question(">> Path to Trove's Live directory: ", function(dir) {
        if (dir === '') {
          rl.close();
          return reject(new Error("Skipped importing Trove blueprints because of no Trove directory specified."));
        }
        trovedir = dir;
        resolve(true);
      });
      rl.on('SIGINT', function() {
        rl.close();
        reject(new Error("Skipped importing Trove blueprints because of no Trove directory specified."));
      });
    });
  }).then((retry) => {
    if (retry) return setup();
    log.info('cleaning and setting up import environment (could take a minute)...');
    let promises = [];
    promises.push(fs.statAsync('qbexport').then((stats) => {
      if (!stats.isDirectory()) return Promise.reject(new Error("qbexport is not a directory"));
    }).catch((err) => {
      if (err.code !== 'ENOENT') return Promise.reject(err);
      return fs.mkdirAsync('qbexport', 0x1ed);
    }));
    let dirs = ['bpexport/*', 'qbexport/*'];
    if (process.platform === 'darwin'){
      dirs.push(join(process.env.HOME, 'Documents/Trion Worlds/Trove/DevTool.log'));
      promises.push(fs.chmodAsync('../MacOS/Trove', 0x1e4)); // fix devtool permissions on OS X
    }
    else {
      dirs.push('%appdata%\\Trove\\DevTool.log');
    }
    promises.push(del(dirs)); // clean bpexport and qbexport
    return Promise.all(promises);
  });
}

function extractBlueprints(){
  log.info('extracting 2 blueprint archives (could take a minute)...');
  return Promise.map(['blueprints', 'blueprints/equipment/ring'], (archive) => {
    return child_process.execFileAsync(devtool, ['-tool', 'extractarchive', archive, 'bpexport'], {timeout: 60000}).catch((err) => {
      if (err.killed || err.signal != null || err.code !== 1) {
        log.error(err);
        return Promise.reject(new Error(`failed to extract archive: ${archive}`));
      }
    }).then(() => log.info(`archive ${archive} sucessfully extracted!`));
  });
}

function getChangedBps(){
  const crypto = require('crypto');
  return fs.readdirAsync('bpexport').then(function(bps){
    log.info(`comparing sha256 hashes of ${bps.length} blueprints to determine changed ones...`);
    const oldModels = require(`${repo}/Trove.json`);
    const oldAPs = require(`${repo}/Trove_ap.json`);
    const oldErrs = require(`${repo}/Trove_err.json`);
    let oldSha256 = require(`${repo}/Trove_sha256.json`);
    if (argv.a){ // reimport all bps
      oldSha256 = [];
    }
    else {
      if (argv.e){ // reimport errored bps
        for (let i = 0; i < oldErrs.err.length; i++){
          oldSha256[oldErrs.err[i]] = null;
        }
        log.info(`reimporting all ${oldErrs.err.length} blueprints with errors`);
      }
      if (argv.w){ // reimport bps with warnings
        for (let i = 0; i < oldErrs.warn.length; i++){
          oldSha256[oldErrs.warn[i]] = null;
        }
        log.info(`reimporting all ${oldErrs.warn.length} blueprints with warnings`);
      }
    }
    let newSha256 = {};
    let promises = [];
    return Promise.map(bps, (f) => {
      if (f.length > 10 && f.indexOf('.blueprint') === f.length - 10) {
        return fs.readFileAsync(`bpexport/${f}`).then((data) => {
          newSha256[f] = crypto.createHash('sha256').update(data).digest('hex');
          let exp = f.substring(0, f.length - 10);
          if ((oldSha256[f] != null) && oldSha256[f] === newSha256[f] && (oldModels[exp] != null)) {
            models[exp] = oldModels[exp];
            if (oldAPs[exp]) modelAPs[exp] = oldAPs[exp];
            if (oldErrs.warn.indexOf(f) != -1) brokenBps.warn.push(f);
            if (oldErrs.err.indexOf(f) != -1) brokenBps.err.push(f);
          } else {
            changedFiles.push(f);
          }
        });
      }
    }).then(() => {
      log.info(`found ${changedFiles.length} new or updated blueprints for reimport`);
      return fs.writeFileAsync(`${repo}/Trove_sha256.json`, stringify(newSha256, {space: '  '}));
    }).then(() => {
      log.info(`sha256 data of ${Object.keys(newSha256).length} blueprints successfully written to ${repo}/Trove_sha256.json`);
    });
  });
}

function importBps(){
  let failedBlueprints = [];
  let processed = 0;
  const clog = console.log;
  require('coffee-script/register');
  require('troxel/test/TestUtils');
  const QubicleIO = require('troxel/coffee/Qubicle.io');
  const Base64IO = require('troxel/coffee/Troxel.io');
  let isTTY = process.stdout.isTTY;
  let cursor = require('ansi')(process.stdout);
  let barWidth = process.stdout.getWindowSize()[0] - 17;
  cursor.write('\n\n');

  function importBp(f, exp, len){
    return child_process.execFileAsync(devtool, ['-tool', 'copyblueprint', '-generatemaps', '1', `bpexport/${f}`, `qbexport/${exp}.qb`], {timeout: 15000}).then(() => true).catch((err) => {
      if (err.killed || err.signal != null || err.code !== 1) return false;
      return true;
    }).then((done) => {
      if (!done) return false;
      return fs.statAsync(`qbexport/${exp}.qb`).then((stats) => stats.isFile()).catch((err) => {
        if (err.cause.code === 'ENOENT') {
          return false; // devtool silent error (.qb file does not exists)
        }
        return Promise.reject(err);
      });
    }).then((done) => {
      if (done){
        let qbf = `qbexport/${exp}`;
        return Promise.all([fs.readFileAsync(`${qbf}.qb`), fs.readFileAsync(`${qbf}_a.qb`), fs.readFileAsync(`${qbf}_t.qb`), fs.readFileAsync(`${qbf}_s.qb`)]).then((abs) => {
          let io = new QubicleIO(abs.map((b) => new Uint8Array(b).buffer));
          if (io.APpos){
            let ap = io.getAttachmentPoint();
            if (ap[0] !== io.APpos[0] || ap[1] !== io.APpos[1] || ap[2] !== io.APpos[2]){
              modelAPs[exp] = io.APpos;
              if (ap[0] !== 0 || ap[1] !== 0 || ap[2] !== 0){
                cursor.write(`Warn in ${f}: APpos from qb meta data does not match real AP!\n`);
                io.warn.push('APpos from qb meta data does not match real attachment point!');
              }
            }
          }
          let bb = io.computeBoundingBox();
          io.resize(bb[0], bb[1], bb[2], bb[3], bb[4], bb[5]);
          if (modelAPs[exp] && (bb[3] !== 0 || bb[4] !== 0 || bb[5] !== 0)){
            modelAPs[exp][0] -= bb[3];
            modelAPs[exp][1] -= bb[4];
            modelAPs[exp][2] -= bb[5];
          }
          models[exp] = new Base64IO(io).export(true, 2);
          if (io.warn.length > 0) brokenBps.warn.push(f);
          return ["imported: " + f, false, io.warn.length > 0];
        });
      } else { // devtool error
        failedBlueprints.push(f);
        return ["skipped (devtool not responding): " + f, true, false];
      }
    }).spread((msg, err, warn) => {
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
        let toProcess = len - ++processed;
        let s = Math.round(toProcess / len * barWidth);
        cursor.write(`╢${Array(barWidth - s).join('█')}${Array(s).join('░')}╟ ${toProcess} bp left\n`);
      }
    });
  }

  return Promise.map(changedFiles, (f, i, len) => {
    let exp = f.substring(0, f.length - 10);
    return importBp(f, exp, len);
  }, {concurrency: jobs}).then(() => {
    if (failedBlueprints.length > 0) {
      cursor.write(`\nretrying ${failedBlueprints.length} broken blueprints in series:\n\n\n`);
      processed = 0;
      let retryBps = failedBlueprints;
      failedBlueprints = [];
      return Promise.mapSeries(retryBps, (f, i, len) => {
        let exp = f.substring(0, f.length - 10);
        return importBp(f, exp, len);
      }).then(() => {
        cursor.bg.red().write(`\nskipping ${failedBlueprints.length} broken blueprints:`).bg.reset().write('\n');
        for (let i = 0; i < failedBlueprints.length; i++){
          brokenBps.err.push(failedBlueprints[i]);
          cursor.bg.red().write(`  * ${failedBlueprints[i]}`).bg.reset().write('\n');
        }
      });
    }
  }).then(() => {
    cursor.write('\n');
    console.log = clog;
    brokenBps.err = brokenBps.err.sort();
    brokenBps.warn = brokenBps.warn.sort();
    return Promise.all([fs.writeFileAsync(`${repo}/Trove.json`, stringify(models, {space: '  '})).then(() => {
      log.info(`base64 data of ${Object.keys(models).length} (${changedFiles.length} new) blueprints successfully written to ${repo}/Trove.json`);
    }), fs.writeFileAsync(`${repo}/Trove_ap.json`, stringify(modelAPs, {space: '  '})).then(() => {
      log.info(`AP data of ${Object.keys(modelAPs).length} blueprints successfully written to ${repo}/Trove_ap.json`);
    }), fs.writeFileAsync(`${repo}/Trove_err.json`, stringify(brokenBps, {space: '  '})).then(() => {
      log.info(`${brokenBps.err.length} error and ${brokenBps.warn.length} warning data successfully written to ${repo}/Trove_err.json`);
    })]);
  });
}

function cleanup(){
  log.info('cleaning up (could take a minute)...');
  return del(['bpexport/*', 'qbexport/*']).then(() => process.chdir(repo));
}

gulp.task('default', gulp.series(setup, extractBlueprints, getChangedBps, importBps, cleanup));

// rebasing git tags

function getGitTags(){
  return child_process.execAsync('git tag | sort -r').then((stdout) => stdout.trim().split('\n'));
}

gulp.task('rebaseTags', function rebaseGitTags(){
  return getGitTags().then((git_tags) => {
    return Promise.map(git_tags, (tag) => {
      return child_process.execFileAsync('git', ['log', '-1', '--pretty=format:%H\n%s', tag]).then((stdout) => {
        let tag_data = stdout.trim().split('\n');
        return child_process.execAsync(`git log --pretty="%H|||%s" master | grep "${tag_data[1]}"`).then((stdout) => {
          let commit_data = stdout.trim().split('|||');
          if (commit_data[0] === tag_data[0]){
            console.log(`tag ${tag} needs no rebase`);
          }
          else {
            return child_process.execFileAsync('git', ['tag', '--force', tag, commit_data[0]]).then((stdout) => {
              console.log(`tag ${tag} sucessfully rebased from ${tag_data[0]} to ${commit_data[0]}`);
            });
          }
        });
      })
    })
  });
});

// Build git tag based JSON directory

let git_tags;

function prepareBuild(){
  return Promise.join(getGitTags(), fs.mkdirAsync('dist'), (gt) => git_tags = gt);
}

function buildIndex(){
  let index = {
    version: [1, 0],
    latest: process.env.TRAVIS_TAG,
    tags: git_tags
  };
  return fs.writeFileAsync('dist/index.json', JSON.stringify(index));
}

function buildTagsJSON(){
  const replaceStream = require('replacestream');
  const mergeStream = require('merge-stream');
  let merged = mergeStream();
  for (let i = 0; i < git_tags.length; i++){
    let tag = git_tags[i];
    const gs = child_process.spawn('git', ['show', `${tag}:Trove.json`]);
    gs.stdout.pipe(replaceStream(/\s/g, '')).pipe(fs.createWriteStream(`dist/${tag}.json`));
    merged.add(gs.stdout);
    if (tag > '2016-03'){
      const gsap = child_process.spawn('git', ['show', `${tag}:Trove_ap.json`]);
      gsap.stdout.pipe(replaceStream(/\s/g, '')).pipe(fs.createWriteStream(`dist/${tag}_ap.json`));
      merged.add(gsap.stdout);
    }
  }
  return merged;
}

gulp.task('build', gulp.series(prepareBuild, gulp.parallel(buildIndex, buildTagsJSON)));

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
