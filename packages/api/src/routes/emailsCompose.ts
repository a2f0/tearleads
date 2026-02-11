import { Router, type Router as RouterType } from 'express';
import { registerDeleteDraftsIdRoute } from './emailsCompose/delete-drafts-id.js';
import { registerGetDraftsRoute } from './emailsCompose/get-drafts.js';
import { registerGetDraftsIdRoute } from './emailsCompose/get-drafts-id.js';
import { registerPostDraftsRoute } from './emailsCompose/post-drafts.js';
import { registerPostSendRoute } from './emailsCompose/post-send.js';

const emailsComposeRouter: RouterType = Router();
registerPostDraftsRoute(emailsComposeRouter);
registerGetDraftsRoute(emailsComposeRouter);
registerGetDraftsIdRoute(emailsComposeRouter);
registerDeleteDraftsIdRoute(emailsComposeRouter);
registerPostSendRoute(emailsComposeRouter);

export { emailsComposeRouter };
