import type { ApiRequestInstrumentation } from "../apiRequestMetrics";
import { ApiClientContext } from "./apiClientContext";
import type { ApiClientSelf } from "./apiClientSelf";
import { BillingArea } from "./billing";
import { BlobArea } from "./blobs";
import { ContainerMutationArea } from "./containerMutations";
import { ContainerReadArea } from "./containerReads";
import { DocumentArea } from "./documents";
import { IdentityArea } from "./identities";
import { OrganizationArea } from "./organizations";
import { PrincipalPolicyArea } from "./principalPolicies";
import { RootAdminArea } from "./rootAdmin";
import { SessionArea } from "./session";
import { WriterProjectionArea } from "./writerProjections";

/**
 * Builds one shared context and every request area over it. `ApiClient`
 * extends this to publish each area method as its own instance property;
 * the abstract members are the ones areas call back through the instance.
 */
export abstract class ApiClientAreas implements ApiClientSelf {
  abstract authenticateWithChallenge: ApiClientSelf["authenticateWithChallenge"];
  abstract clearWriterProjectionCaches: ApiClientSelf["clearWriterProjectionCaches"];
  abstract commitOrganizationGroupPolicyResult: ApiClientSelf["commitOrganizationGroupPolicyResult"];
  abstract createOrganizationGroupResult: ApiClientSelf["createOrganizationGroupResult"];
  abstract deleteContainerResult: ApiClientSelf["deleteContainerResult"];
  abstract deleteOrganizationGroupResult: ApiClientSelf["deleteOrganizationGroupResult"];
  abstract evictDocumentWriterProjection: ApiClientSelf["evictDocumentWriterProjection"];
  abstract getAuthToken: ApiClientSelf["getAuthToken"];
  abstract getRequestFailure: ApiClientSelf["getRequestFailure"];
  abstract shareContainerResult: ApiClientSelf["shareContainerResult"];

  protected readonly context: ApiClientContext;
  protected readonly session: SessionArea;
  protected readonly identities: IdentityArea;
  protected readonly policies: PrincipalPolicyArea;
  protected readonly organizations: OrganizationArea;
  protected readonly billing: BillingArea;
  protected readonly root: RootAdminArea;
  protected readonly containerWrites: ContainerMutationArea;
  protected readonly containerReads: ContainerReadArea;
  protected readonly documents: DocumentArea;
  protected readonly blobs: BlobArea;
  protected readonly projections: WriterProjectionArea;

  constructor(
    baseUrl?: string | null,
    instrumentation?: ApiRequestInstrumentation,
  ) {
    const context = new ApiClientContext(baseUrl, instrumentation);
    this.context = context;
    this.session = new SessionArea(context, this);
    this.identities = new IdentityArea(context, this);
    this.policies = new PrincipalPolicyArea(context, this);
    this.organizations = new OrganizationArea(context);
    this.billing = new BillingArea(context);
    this.root = new RootAdminArea(context);
    this.containerWrites = new ContainerMutationArea(context, this);
    this.containerReads = new ContainerReadArea(context);
    this.documents = new DocumentArea(context, this);
    this.blobs = new BlobArea(context);
    this.projections = new WriterProjectionArea(context);
  }
}
