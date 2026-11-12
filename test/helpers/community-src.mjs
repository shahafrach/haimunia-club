// The community edition's tests scan its community layer (cloud.js and
// src/community/*.js) alongside app.js. This edition ships none of it, so the
// scans that came across with those tests run over an empty set here and keep
// checking app.js - which is the part of them that still applies. Kept under
// the same name so the carried-over tests read the same in both repositories.
export const COMMUNITY_MODULES = [];
export const COMMUNITY_FILES = [];
export function cloudSource() { return ""; }
export function communityFile() { return ""; }
