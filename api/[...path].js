import { handleApiRequest } from "../src/api/handler.js";

export default async function handler(request, response) {
  await handleApiRequest(request, response);
}
