# Changelog

## [1.2.0](https://github.com/MapColonies/cleaner/compare/v1.1.3...v1.2.0) (2026-07-30)


### Features

* delete layer (MAPCO-1159) ([#33](https://github.com/MapColonies/cleaner/issues/33)) ([eb4c9c9](https://github.com/MapColonies/cleaner/commit/eb4c9c96971e15b100ed6d0e3c24c4d575f058dc))

## [1.1.3](https://github.com/MapColonies/cleaner/compare/v1.1.2...v1.1.3) (2026-05-17)


### Bug Fixes

* log successful job tracker notification ([#30](https://github.com/MapColonies/cleaner/issues/30)) ([aa14ee0](https://github.com/MapColonies/cleaner/commit/aa14ee0e1f9d73c37a29f68a50f42dda793c9268))

## [1.1.2](https://github.com/MapColonies/cleaner/compare/v1.1.1...v1.1.2) (2026-05-17)


### Bug Fixes

* update httpRetry delay configuration format ([#28](https://github.com/MapColonies/cleaner/issues/28)) ([d42e0e9](https://github.com/MapColonies/cleaner/commit/d42e0e9ba72e70ee68557656de63ad0ad25d0ebe))

## [1.1.1](https://github.com/MapColonies/cleaner/compare/v1.1.0...v1.1.1) (2026-05-17)


### Bug Fixes

* values and deletion erros(MAPCO-10629) ([#26](https://github.com/MapColonies/cleaner/issues/26)) ([31c16e6](https://github.com/MapColonies/cleaner/commit/31c16e6716b3b4a4807ca025f1be4374c0a1f707))

## [1.1.0](https://github.com/MapColonies/cleaner/compare/v1.0.1...v1.1.0) (2026-05-13)


### Features

* fs s3 integration and tilesDeletionStartegy(MAPCO-9806) ([#24](https://github.com/MapColonies/cleaner/issues/24)) ([0ad7e30](https://github.com/MapColonies/cleaner/commit/0ad7e30589fa4c66cae1d0b528294e8e06732db8))
* polling loop (MAPCO-9805) ([#21](https://github.com/MapColonies/cleaner/issues/21)) ([318aea0](https://github.com/MapColonies/cleaner/commit/318aea0e01fbd00abd27896f9d6a75665fba1ed7))

## [1.0.1](https://github.com/MapColonies/cleaner/compare/v1.0.0...v1.0.1) (2026-02-23)


### Bug Fixes

* **ci:** modify build-and-push workflow for raster domain ([8f85e07](https://github.com/MapColonies/cleaner/commit/8f85e077b7e71367322731754c5256f640a41f08))

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
