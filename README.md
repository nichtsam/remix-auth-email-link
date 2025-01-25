# Email Link Strategy - Remix Auth

> This strategy is heavily based on **kcd** strategy present in the [v2 of Remix Auth](https://github.com/sergiodxa/remix-auth/blob/v2.6.0/docs/strategies/kcd.md). The major difference being we are using `crypto-js` instead of `crypto` so that it can be deployed on CF.

The Email Link Strategy implements the authentication strategy used on [kentcdodds.com](https://kentcdodds.com).

This strategy uses passwordless flow with magic links. A magic link is a special URL generated when the user tries to login, this URL is sent to the user via email, after the click on it the user is automatically logged in.

You can read more about how this work in the [kentcdodds.com/how-i-built-a-modern-website-in-2021](https://kentcdodds.com/blog/how-i-built-a-modern-website-in-2021#authentication-with-magic-links).

## Supported runtimes

| Runtime    | Has Support |
| ---------- | ----------- |
| Node.js    | ✅          |
| Cloudflare | ✅          |

<!-- If it doesn't support one runtime, explain here why -->

## How to use

<!-- Explain how to use the strategy, here you should tell what options it expects from the developer when instantiating the strategy -->

## Setup

Because of how this strategy works you need a little bit more setup than other strategies, but nothing specially crazy.

### Email Service

You will need to have some email service configured in your application. What you actually use to send emails is not important, as far as you can create a function with this type:

```ts
type SendEmailOptions = {
  email: string;
  magicLink: string;
};

type SendEmailFunction = (options: SendEmailOptions) => void | Promise<void>;
```

So if you have something like `app/services/email-provider.server.ts` file exposing a generic function like `sendEmail` function receiving an email address, subject and body, you could use it like this:

```tsx
// app/services/email.server.tsx
import { renderToString } from "react-dom/server";
import type { SendEmailFunction } from "@nichtsam/remix-auth-email-link";
import { type User, getUserByEmail } from "~/models/user.model";
import * as emailProvider from "~/services/email-provider.server";

export let sendEmail: SendEmailFunction = async (options) => {
  let user = getUserByEmail(option.emal);
  let subject = "Here's your Magic sign-in link";
  let body = renderToString(
    <p>
      Hi {user?.name || "there"},<br />
      <br />
      <a href={options.magicLink}>Click here to login on example.app</a>
    </p>,
  );

  await emailProvider.sendEmail(options.email, subject, body);
};
```

Again, what you use as email provider is not important, you could use a third party service like [Mailgun](https://mailgun.com) or [Sendgrid](https://sendgrid.com), if you are using AWS you could use SES.

### Create the strategy instance

Now that you have your sendEmail email function you can create an instance of the Authenticator and the EmailLinkStrategy.

```ts
// app/services/auth.server.ts
import { Authenticator } from "remix-auth";
import { EmailLinkStrategy } from "@nichtsam/remix-auth-email-link";
import { sessionStorage } from "~/services/session.server";
import { sendEmail } from "~/services/email.server";
import { User, getUserByEmail } from "~/models/user.server";

// This secret is used to encrypt the token sent in the magic link and the
// session used to validate someone else is not trying to sign-in as another
// user.
let secret = process.env.MAGIC_LINK_SECRET;
if (!secret) throw new Error("Missing MAGIC_LINK_SECRET env variable.");

export let auth = new Authenticator<User>(sessionStorage);

auth.use(
  new EmailLinkStrategy(
    { sendEmail, secret, magicEndpoint: "https://example.app/auth/magic" },
    async ({ email }) => {
      // here you can use the params above to get the user and return it
      // what you do inside this and how you find the user is up to you
      let user = await getUserByEmail(email);
      return user;
    },
  ),
);
```

### Setup your routes

Now you can proceed to create your routes and do the setup.

```tsx
// app/routes/login.tsx
import { ActionArgs, LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Cookie } from "@mjackson/headers";
import { auth } from "~/services/auth.server";

export let loader = async ({ request }: LoaderArgs) => {
  await auth.isAuthenticated(request, { successRedirect: "/me" });

  return json({
    magicLinkSent: new Cookie(request.headers.get("cookie") ?? "").has(this.cookieName),
  });
};

export let action = async ({ request }: ActionArgs) => {
 // A `Headers` object containing the `Set-Cookie` header with the token will be thrown.
 // You need to catch this and decide whether to include the cookie in your response.
 // Note that the token cookie is required if `shouldValidateSessionMagicLink` is enabled.
 // While this approach might seem suboptimal, it provides flexibility in customizing your response logic.
  const headers = await authenticator
    .authenticate("email-link", request)
    .catch((headers) => headers);
  throw redirect("/login", { headers });
};

// app/routes/login.tsx
export default function Login() {
  let { magicLinkSent } = useLoaderData<typeof loader>();

  return (
    <Form action="/login" method="post">
      {magicLinkSent ? (
        <p>
          Successfully sent magic link{
        </p>
      ) : (
        <>
          <h1>Log in to your account.</h1>
          <div>
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" name="email" required />
          </div>
          <button>Email a login link</button>
        </>
      )}
    </Form>
  );
}
```

```tsx
// app/routes/magic.tsx
import { LoaderArgs } from "@remix-run/node";
import { auth } from "~/services/auth.server";

export let loader = async ({ request }: LoaderArgs) => {
  const user = await auth.authenticate("email-link", request);
  // now you have the user object with the data you returned in the verify function
};
```

## Email validation

The EmailLinkStrategy also supports email validation, this is useful if you want to prevent someone from signing-in with a disposable email address or you have some denylist of emails for some reason.

By default, the EmailStrategy will validate every email against the regular expression `/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/`, if it doesn't pass it will throw an error.

If you want to customize it you can create a function with this type and pass it to the EmailLinkStrategy.

```ts
type ValidateEmailFunction = (email: string) => boolean | Promise<boolean>;
```

### Example

```ts
// app/services/verifier.server.ts
import { VerifyEmailFunction } from "remix-auth-email-link";
import { isEmailBurner } from "burner-email-providers";
import isEmail from "validator/lib/isEmail";

export let verifyEmailAddress: VerifyEmailFunction = async (email) => {
  return isEmail(email) && !isEmailBurner(email);
};
```
