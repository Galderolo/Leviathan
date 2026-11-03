/**
 * What git's message says about the credentials of a remote over HTTPS: `rejected` when the server refused those sent
 * (a token revoked, expired or without the rights), `missing` when git had none to send; null for any other failure.
 */
export function authProblem(message: string): 'rejected' | 'missing' | null {
  if (/could not read (Username|Password) for|terminal prompts disabled/i.test(message)) return 'missing'
  if (
    /Invalid username or (password|token)|Authentication failed for|HTTP Basic: Access denied|returned error: 40[13]\b/i.test(
      message
    )
  ) {
    return 'rejected'
  }
  return null
}
