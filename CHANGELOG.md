# Changelog

## 1.0.0 (2026-02-22)


### Features

* **config:** add queue, polling, and HTTP retry configuration ([969b7e2](https://github.com/MapColonies/cleaner/commit/969b7e24cf903976bddff8fd7c96f4b942609164))
* **constants:** add service tokens for cleaner implementation ([4e63eb5](https://github.com/MapColonies/cleaner/commit/4e63eb5b5d89999ba97508f81e870b2ad6f802e1))
* **errors:** add custom error classes and core types ([3bae874](https://github.com/MapColonies/cleaner/commit/3bae874d42098ec3e7c839af29ee2bd4b2cf7120))
* **errors:** add ErrorHandler for centralized error handling ([c83baac](https://github.com/MapColonies/cleaner/commit/c83baac39a516502c71cbab92df1e7788fc0ffd3))
* implement cleaner worker skeleton with error handling, validation, and strategy pattern (MAPCO-9803) ([bf43c75](https://github.com/MapColonies/cleaner/commit/bf43c75a0fd26a5ac640b1f85b6cf77d611379ae))
* **strategies:** add strategy pattern with factory and tiles-deletion stub ([920cd42](https://github.com/MapColonies/cleaner/commit/920cd42fec89983e0f9d9db39c90a08faedd0c35))
* update project references from jobnik-worker-boilerplate to cleaner ([8289f6c](https://github.com/MapColonies/cleaner/commit/8289f6c055f245bc8fb0a58a6654cd102d895b52))
* **validation:** add task parameter validation infrastructure ([82ab7af](https://github.com/MapColonies/cleaner/commit/82ab7afcf657f04df65bc714be2f99604c52e968))
* **worker:** add explicit capability pairs configuration ([9776cc4](https://github.com/MapColonies/cleaner/commit/9776cc4c6d4a4b8cb53d0e16d3c1e1e2ba5717ac))


### Bug Fixes

* ensure stack trace is captured for custom errors ([708a445](https://github.com/MapColonies/cleaner/commit/708a4459ceaba4d8866169792ec1660acd14675a))
* **tests:** use faker for dynamic job and task IDs in strategy tests ([fafe8dd](https://github.com/MapColonies/cleaner/commit/fafe8ddca789470a2323a1058fc3147243e99b6e))
