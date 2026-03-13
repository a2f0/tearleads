import type {
  AddMlsMemberRequestShape,
  AddMlsMemberResponseShape,
  MlsGroup,
  MlsGroupMember,
  MlsGroupMembersResponseShape,
  MlsGroupRole,
  MlsGroupStateResponseShape,
  MlsGroupStateShape,
  MlsKeyPackageShape,
  MlsKeyPackagesResponseShape,
  MlsMessageShape,
  MlsMessagesResponseShape,
  MlsMessageType,
  MlsWelcomeMessageShape,
  MlsWelcomeMessagesResponseShape,
  RemoveMlsMemberRequestShape,
  SendMlsMessageRequestShape,
  SendMlsMessageResponseShape,
  UploadMlsKeyPackagesRequestShape,
  UploadMlsKeyPackagesResponseShape,
  UploadMlsStateRequestShape,
  UploadMlsStateResponseShape
} from './mlsCoreTypes.js';

export type MlsBinaryGroup = MlsGroup;
export type MlsBinaryGroupMember = MlsGroupMember;
export type MlsBinaryGroupRole = MlsGroupRole;
export type MlsBinaryMessageType = MlsMessageType;

export type MlsBinaryKeyPackage = MlsKeyPackageShape<Uint8Array>;

export type UploadMlsKeyPackagesBinaryRequest =
  UploadMlsKeyPackagesRequestShape<Uint8Array>;

export type UploadMlsKeyPackagesBinaryResponse =
  UploadMlsKeyPackagesResponseShape<Uint8Array>;

export type MlsBinaryKeyPackagesResponse =
  MlsKeyPackagesResponseShape<Uint8Array>;

export type AddMlsMemberBinaryRequest = AddMlsMemberRequestShape<Uint8Array>;

export type AddMlsMemberBinaryResponse = AddMlsMemberResponseShape;

export interface MlsBinaryGroupMembersResponse
  extends MlsGroupMembersResponseShape {}

export type RemoveMlsMemberBinaryRequest =
  RemoveMlsMemberRequestShape<Uint8Array>;

export type MlsBinaryMessage = MlsMessageShape<Uint8Array>;

export type SendMlsMessageBinaryRequest =
  SendMlsMessageRequestShape<Uint8Array>;

export type SendMlsMessageBinaryResponse =
  SendMlsMessageResponseShape<Uint8Array>;

export type MlsBinaryMessagesResponse = MlsMessagesResponseShape<Uint8Array>;

export type MlsBinaryWelcomeMessage = MlsWelcomeMessageShape<Uint8Array>;

export type MlsBinaryWelcomeMessagesResponse =
  MlsWelcomeMessagesResponseShape<Uint8Array>;

export type MlsBinaryGroupState = MlsGroupStateShape<Uint8Array>;

export type UploadMlsStateBinaryRequest =
  UploadMlsStateRequestShape<Uint8Array>;

export type UploadMlsStateBinaryResponse =
  UploadMlsStateResponseShape<Uint8Array>;

export type MlsBinaryGroupStateResponse =
  MlsGroupStateResponseShape<Uint8Array>;
