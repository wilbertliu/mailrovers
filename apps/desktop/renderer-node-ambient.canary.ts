// This compiler-only canary must remain outside production renderer sources.
// @ts-expect-error Renderer code must not receive the Node process ambient.
void process
// @ts-expect-error Renderer code must not receive CommonJS require.
void require
// @ts-expect-error Renderer code must not receive Node Buffer.
void Buffer
