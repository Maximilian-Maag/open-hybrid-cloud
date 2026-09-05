/**
 * Sign-in failures the login form has to tell apart, as stable identifiers.
 *
 * NextAuth collapses every rejected `authorize` into a single
 * `CredentialsSignin` error, so a locked-out second factor and a mistyped code
 * arrive at the form as the same thing — and the form then says "invalid
 * credentials", which is precisely the advice that makes a locked-out user keep
 * retrying. The one channel that survives is the `code` on a thrown
 * `CredentialsSignin`, which comes back as `signIn(...).code`.
 *
 * These are identifiers, not messages: NextAuth puts the code in a URL query
 * parameter, and the text the user reads is translated in the form. They live in
 * their own module because the login form is a client component and must not
 * pull in the NextAuth server config to read a constant.
 */
export const MFA_LOCKED_OUT = 'mfa_locked_out'
