// Secure defaults. Providers and local email require separate explicit runtime gates.
export const authOptions = {
  emailAndPassword: {
    enabled: false,
    requireEmailVerification: true,
  },
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,
      allowDifferentEmails: false,
      requireLocalEmailVerified: true,
    },
  },
  session: {
    freshAge: 60 * 15,
    cookieCache: { enabled: false },
  },
  user: {
    validateUserInfo: ({ user, source }: {
      user: { email?: string | null };
      source: { oauth?: { providerId: string } };
    }) => {
      if (source.oauth?.providerId === "discord" && !user.email) {
        return { error: "email_required" };
      }
    },
  },
} as const;
