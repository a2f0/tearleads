export interface KeyStatus {
  salt: boolean;
  keyCheckValue: boolean;
  wrappingKey: boolean;
  wrappedKey: boolean;
}

export interface InstanceMetadata {
  id: string;
  name: string;
  createdAt: number;
  lastAccessedAt: number;
}
