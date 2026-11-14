#!/usr/bin/env node
// Make the standalone binary behave like: testorbit skill-gen.
process.argv.splice(2, 0, 'skill-gen');
await import('./index.js');
