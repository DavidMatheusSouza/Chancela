// Build-time stand-in for @chancela/shared: only what the SDK uses, so the
// published bundle does not drag in the schemas (and zod) it never touches.
export { canonicalJSON } from '../shared/src/canonical';
export { hashIntent } from '../shared/src/hash';
