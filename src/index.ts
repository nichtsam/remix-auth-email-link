import { Cookie, SetCookie, type SetCookieInit } from "@mjackson/headers";
import crypto from "crypto-js";
import { Strategy } from "remix-auth/strategy";

type URLConstructor = ConstructorParameters<typeof URL>[0];

export const NAME = "email-link";

export class EmailLinkStrategy<User> extends Strategy<
  User,
  EmailLinkStrategy.VerifyOptions
> {
  name = NAME;
  protected options: Required<EmailLinkStrategy.ConstructorOptions>;

  constructor(
    {
      cookie = NAME,
      emailField = "email",
      shouldValidateSessionMagicLink = false,
      tokenKey = "token",
      linkMaxAge = 60 * 10,
      validateEmail = (email: string) =>
        /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email),
      ...restOptions
    }: EmailLinkStrategy.ConstructorOptions,
    verify: Strategy.VerifyFunction<User, EmailLinkStrategy.VerifyOptions>,
  ) {
    super(verify);

    this.options = {
      cookie,
      emailField,
      shouldValidateSessionMagicLink,
      tokenKey,
      linkMaxAge,
      validateEmail,
      ...restOptions,
    };
  }

  private get cookieName() {
    if (typeof this.options.cookie === "string") {
      return this.options.cookie || NAME;
    }
    return this.options.cookie.name || NAME;
  }

  private get cookieOptions() {
    if (typeof this.options.cookie !== "object") return {};
    return this.options.cookie;
  }

  private async createMagicLink(email: string) {
    const payload = {
      email,
      createdAt: Date.now(),
    };

    const encrypted = await this.encrypt(JSON.stringify(payload));
    const url = new URL(this.options.magicEndpoint);
    url.searchParams.set(this.options.tokenKey, encrypted);
    return { magicLink: url.toString(), token: encrypted };
  }

  private async sendToken(email: string): Promise<Headers> {
    const valid = await this.options.validateEmail(email);
    if (!valid) {
      throw new Error("Email is invalid");
    }

    const { magicLink, token } = await this.createMagicLink(email);

    await this.options.sendEmail({
      email,
      magicLink,
    });

    const cookie = new SetCookie({
      name: this.cookieName,
      value: new URLSearchParams({
        [this.options.tokenKey]: token,
      }).toString(),
      httpOnly: true,
      maxAge: this.options.linkMaxAge,
      path: "/",
      sameSite: "Lax",
      ...this.cookieOptions,
    });

    return new Headers({ "Set-Cookie": cookie.toString() });
  }

  private async validateToken(request: Request) {
    const requestParams = new URL(request.url).searchParams;
    if (!requestParams.has(this.options.tokenKey)) {
      throw new ReferenceError("Missing token on params.");
    }

    const requestToken = requestParams.get(this.options.tokenKey) ?? "";

    let payload: {
      email: string;
      createdAt: number;
    };

    try {
      const decrypted = await this.decrypt(requestToken);
      payload = JSON.parse(decrypted);
    } catch (err: unknown) {
      throw new TypeError("Invalid Token");
    }

    if (this.options.shouldValidateSessionMagicLink) {
      const cookieParams = new URLSearchParams(
        new Cookie(request.headers.get("cookie") ?? "").get(this.cookieName),
      );

      if (!cookieParams.has(this.options.tokenKey)) {
        throw new Error(
          "Missing token on cookie, required by additional security layer.",
        );
      }

      const cookieToken = cookieParams.get(this.options.tokenKey);

      if (requestToken !== cookieToken) {
        throw new Error("Token doesn't match cookie");
      }
    }

    const expirationTime = payload.createdAt + this.options.linkMaxAge * 1000;
    if (Date.now() > expirationTime) {
      throw new Error("Token expired. Please request a new one.");
    }

    return payload.email;
  }

  public async authenticate(request: Request): Promise<User> {
    const url = new URL(request.url);
    const token = url.searchParams.get(this.options.tokenKey);

    if (!token) {
      const formData = await request.clone().formData();
      const email = formData.get(this.options.emailField);
      if (!email) {
        throw new Error(
          "Email is required to initiate the authentication process",
        );
      }

      if (typeof email !== "string") {
        throw new Error("Email must be a string.");
      }

      throw await this.sendToken(email);
    }

    const email = await this.validateToken(request);
    return this.verify({ email });
  }

  private async encrypt(value: string): Promise<string> {
    return crypto.AES.encrypt(value, this.options.secret).toString();
  }

  private async decrypt(value: string): Promise<string> {
    const bytes = crypto.AES.decrypt(value, this.options.secret);
    return bytes.toString(crypto.enc.Utf8);
  }
}

export namespace EmailLinkStrategy {
  /**
   * This interface declares what the developer will receive from the strategy
   * to verify the user identity in their system.
   */
  export interface VerifyOptions {
    email: string;
  }

  /**
   * This interface declares what configuration the strategy needs from the
   * developer to correctly work.
   */
  export interface ConstructorOptions {
    /**
     * The name of the cookie used to keep email and magic link around.
     *
     * The email and magic link are stored in a cookie, and this option
     * allows you to customize the cookie if needed.
     * @default "email-link"
     */
    cookie?: string | (Omit<SetCookieInit, "value"> & { name: string });
    /**
     * A secret string used to encrypt and decrypt the token and magic link.
     */
    secret: string;
    /**
     * The name of the form input used to get the email.
     * @default "email"
     */
    emailField?: string;
    /**
     * The endpoint the user will go after clicking on the email link.
     */
    magicEndpoint: URLConstructor;
    /**
     * A function to send the email. This function should receive the email address of the user and the magic link.
     */
    sendEmail: SendEmailFunction;
    /**
     * A function to validate the email address. This function should receive the
     * email address as a string and return a boolean. An Error will be thrown if the validation fails.
     *
     * By default it only test the email against the RegExp `/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/`.
     */
    validateEmail?: ValidateEmailFunction;
    /**
     * The name the strategy will use to identity the token from the magic link.
     * @default "token"
     */
    tokenKey?: string;
    /**
     * Seconds until the magic link expires. Default to 10 minutes.
     * @default 600
     */
    linkMaxAge?: number;
    /**
     * Adds an additional layer of security by validating the magic link.
     * - When set to `true`, the token attached to the magic link is validated against the value stored in cookies during the authentication process.
     * - When set to `false`, the cookie value is ignored, and only the token from the magic link is used to verify the user's identity.
     * @default false
     */
    shouldValidateSessionMagicLink?: boolean;
  }

  type SendEmailOptions = {
    email: string;
    magicLink: string;
  };

  type SendEmailFunction = (options: SendEmailOptions) => void | Promise<void>;

  type ValidateEmailFunction = (email: string) => boolean | Promise<boolean>;
}
