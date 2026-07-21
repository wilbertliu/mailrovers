export type PackagedAppEnvironment = NodeJS.ProcessEnv

export function packagedAppEnvironment(
  parentEnvironment: PackagedAppEnvironment,
): PackagedAppEnvironment {
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...environment } = parentEnvironment
  return environment
}
