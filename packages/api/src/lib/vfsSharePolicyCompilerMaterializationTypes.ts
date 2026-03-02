import type { PolicyPrincipalType } from './vfsSharePolicyCompilerCore.js';

export interface CompiledDecisionInput {
  itemId: string;
  principalType: PolicyPrincipalType;
  principalId: string;
  decision: 'allow' | 'deny';
  accessLevel: 'read' | 'write' | 'admin';
  policyId: string;
  selectorId: string;
  precedence: number;
}
