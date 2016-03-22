# Troxel-Trove-Blueprints [![Build Status](https://travis-ci.org/troxeljs/trove-blueprints.svg)](https://travis-ci.org/troxeljs/trove-blueprints) [![devDependency Status](https://david-dm.org/troxeljs/trove-blueprints/dev-status.svg)](https://david-dm.org/troxeljs/trove-blueprints#info=devDependencies)

This repository contains the voxel data from the `.blueprints` from the voxel MMO [Trove](http://www.trionworlds.com/Trove/) for usage in [Troxel](https://github.com/troxeljs) - a WebGL based voxel viewer and editor WebApp - with permission from Trion Worlds, which holds all right on the listed models.

It's mainly used as a dependency of the Troxel project. Therefore all voxel data in the JSON files are formatted as the base64 representation of Troxel's own voxel format.

The main goals of this repository are:
* moving the big JSON blobs to their own repository reducing the file size of the main repository
* creating a way to uniformly and easily access voxel model data from older versions using a ISO date labeled git tag
* being able to change the format of older voxel data JSON files by heavily using git rebase without messing with the main repository

## Importing Trove Blueprint data
### Dependencies:
* [Node.js 4+](https://nodejs.org/)

### Installing
```
git clone --single-branch https://github.com/troxeljs/trove-blueprints.git troxel-trove-blueprints
cd troxel-trove-blueprints
npm install
```

### Importing
```
npm start
```
You can also pass some optional arguments to the Importer like in `npm start -- -j 8 --trovedir="C:\Trove" -we`. The supported optional arguments are:

* `--trovedir="<PATH_TO_TROVE_DIR>"`: Sets the path to the Trove resource directory (containing the blueprint folder), which should be used instead of the platform specific default install locations. (If the impoter can't find the trove dir you will be asked for it in a interactive prompt. This parameter is completly optionally and only skips this interative prompt for not default Trove installations.)
* `-j 8`: Sets the maximal allowed count of concurrent devtool executions (default to 2 times the number of your cpu cores). You should lower it if you see devtool crashes.
* `-a`: to reimport all blueprints regardless of changes to them (don't skip them even if sha256 sum is still the same)
* `-e`: to reimport all known blueprints with errors (which were skipped to import in a prior run), even if their sha256 sum didn't changed (use it if you want to try if the error was fixed by a devtool update)
* `-w`: to reimport all known blueprints with warnings, even if their sha256 sum didn't changed (always use it after a new blueprint with a warning is detected, because sometimes the devtool is non deterministic and produces unnecessarry warning for some blueprints)
