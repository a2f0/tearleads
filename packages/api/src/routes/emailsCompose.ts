import { Router, type Router as RouterType } from 'express';
import { registerDeleteDraftsIdRoute } from './emailsCompose/deleteDraftsId.js';
import { registerGetDraftsRoute } from './emailsCompose/getDrafts.js';
import { registerGetDraftsIdRoute } from './emailsCompose/getDraftsId.js';
import { registerPostDraftsRoute } from './emailsCompose/postDrafts.js';
import { registerPostSendRoute } from './emailsCompose/postSend.js';

const emailsComposeRouter: RouterType = Router();
registerPostDraftsRoute(emailsComposeRouter);
registerGetDraftsRoute(emailsComposeRouter);
registerGetDraftsIdRoute(emailsComposeRouter);
registerDeleteDraftsIdRoute(emailsComposeRouter);
registerPostSendRoute(emailsComposeRouter);

export { emailsComposeRouter };
