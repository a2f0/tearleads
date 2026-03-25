import { v1 } from "@authzed/authzed-node";

const client = v1.NewClient(
  "in-memory-developer-key",
  "localhost:50051",
  v1.ClientSecurity.INSECURE_LOCALHOST_ALLOWED,
);

export default client;
