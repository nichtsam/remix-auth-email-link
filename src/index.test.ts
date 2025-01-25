/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test";
import { Cookie } from "@mjackson/headers";
import crypto from "crypto-js";
import { EmailLinkStrategy } from ".";

describe(EmailLinkStrategy.name, () => {
  type User = {
    id: string;
  };

  const verify = mock();
  const options = {
    secret: "SECRET",
    magicEndpoint: "https://example.com/magic",
    sendEmail: mock(),
  } satisfies EmailLinkStrategy.ConstructorOptions;

  test("has the name `email-link`", () => {
    const strategy = new EmailLinkStrategy<User>(options, verify);
    expect(strategy.name).toBe("email-link");
  });

  test("requires email to initiate authentication process", async () => {
    const strategy = new EmailLinkStrategy<User>(options, verify);
    const request = new Request("https://example.com/login", {
      method: "post",
      body: new FormData(),
    });

    expect(strategy.authenticate(request)).rejects.toThrowError(
      new Error("Email is required to initiate the authentication process"),
    );
  });

  test("sends email if there's no token in the request url", async () => {
    const strategy = new EmailLinkStrategy<User>(options, verify);
    const email = "test@example.com";
    const formData = new FormData();
    formData.set("email", email);

    const request = new Request("https://example.com/login", {
      method: "post",
      body: formData,
    });

    await strategy.authenticate(request).catch(() => null);

    expect(options.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email }),
    );
  });

  test("throws headers with token cookie", async () => {
    const strategy = new EmailLinkStrategy<User>(options, verify);
    const email = "test@example.com";
    const formData = new FormData();
    formData.set("email", email);

    const request = new Request("https://example.com/login", {
      method: "post",
      body: formData,
    });

    expect(strategy.authenticate(request)).rejects.toThrowError(Headers);
  });

  test("calls verify with the request token", async () => {
    const strategy = new EmailLinkStrategy<User>(options, verify);
    const email = "test@example.com";
    const payload = {
      email,
      createdAt: Date.now(),
    };
    const token = crypto.AES.encrypt(
      JSON.stringify(payload),
      options.secret,
    ).toString();

    const url = new URL(options.magicEndpoint);
    url.searchParams.set("token", token);
    const request = new Request(url);

    await strategy.authenticate(request);
    expect(verify).toHaveBeenCalledWith({ email });
  });

  test("checks for cookie token when `shouldValidateSessionMagicLink` is enabled", async () => {
    const email = "test@example.com";
    const user = { id: "123" };
    verify.mockImplementation(({ email: verifiedEmail }) => {
      if (email === verifiedEmail) {
        return user;
      }
    });

    const strategy = new EmailLinkStrategy<User>(
      { ...options, shouldValidateSessionMagicLink: true },
      verify,
    );

    const payload = {
      email,
      createdAt: Date.now(),
    };
    const token = crypto.AES.encrypt(
      JSON.stringify(payload),
      options.secret,
    ).toString();

    const magicLink = new URL(options.magicEndpoint);
    magicLink.searchParams.set("token", token);
    let request = new Request(magicLink);

    expect(strategy.authenticate(request)).rejects.toThrowError(
      new Error(
        "Missing token on cookie, required by additional security layer.",
      ),
    );

    const cookie = new Cookie();
    cookie.set("email-link", new URLSearchParams({ token }).toString());
    request = new Request(magicLink, {
      headers: { cookie: cookie.toString() },
    });

    expect(strategy.authenticate(request)).resolves.toEqual(user);
  });
});
