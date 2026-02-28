import type { KnipConfig } from 'knip';
import knipConfig from './knip';

const knipDependenciesConfig: KnipConfig = {
  ...knipConfig,
  include: ['dependencies', 'devDependencies', 'unlisted', 'unresolved', 'binaries']
};

export default knipDependenciesConfig;
