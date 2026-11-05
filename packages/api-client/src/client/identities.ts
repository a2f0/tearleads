import { userIdentityOperation } from "@tearleads/validators/operation";
import { bindPrototypeMethods, cachedRequest } from "../requestInternals";
import { userIdentity as authUserIdentity } from "../routes/auth/session";
import type { ApiClientContext } from "./apiClientContext";
import type { ApiClientSelf } from "./apiClientSelf";

/** Published user identities, cached per user until evicted or re-scoped. */
export class IdentityArea {
  constructor(
    private readonly context: ApiClientContext,
    private readonly self: Pick<ApiClientSelf, "getRequestFailure">,
  ) {
    bindPrototypeMethods(this, IdentityArea.prototype);
  }

  getUserIdentity(userId: string) {
    return cachedRequest(
      this.context.userIdentityRequestsByUserId,
      userId,
      () =>
        this.context.send(
          authUserIdentity,
          authUserIdentity.path(userId),
          userIdentityOperation,
        ),
    );
  }

  getUserIdentityRequestFailure(userId: string) {
    return this.self.getRequestFailure({
      method: authUserIdentity.method,
      path: authUserIdentity.path(userId),
    });
  }

  evictUserIdentity(userId: string): void {
    this.context.userIdentityRequestsByUserId.delete(userId);
  }
}
