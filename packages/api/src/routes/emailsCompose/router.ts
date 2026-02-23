import { Router, type Router as RouterType } from 'express';
import { registerDeleteDraftsIdRoute } from './deleteDraftsId.js';
import { registerGetDraftsRoute } from './getDrafts.js';
import { registerGetDraftsIdRoute } from './getDraftsId.js';
import { registerPostDraftsRoute } from './postDrafts.js';
import { registerPostSendRoute } from './postSend.js';

const emailsComposeRouter: RouterType = Router();
registerPostDraftsRoute(emailsComposeRouter);
registerGetDraftsRoute(emailsComposeRouter);
registerGetDraftsIdRoute(emailsComposeRouter);
registerDeleteDraftsIdRoute(emailsComposeRouter);
registerPostSendRoute(emailsComposeRouter);

export { emailsComposeRouter };
