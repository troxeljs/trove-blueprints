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
