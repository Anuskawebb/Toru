export async function sendWelcomeEmail(
  email: string,
  followerAddress: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('[email] Resend API key is missing. Skipping email dispatch.');
    return false;
  }

  // Resend free tier/test accounts must send from "onboarding@resend.dev"
  const from = 'Aether Copy Trading <onboarding@resend.dev>';
  const subject = 'Welcome to Aether Copy Trading!';
  
  const html = `
    <div style="font-family: sans-serif; background-color: #0d0d0d; color: #ffffff; padding: 40px 20px; border-radius: 12px; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #8B5CF6; font-weight: 300; border-bottom: 1px solid #27272a; padding-bottom: 12px; margin-bottom: 20px;">Welcome to Aether</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #a1a1aa;">
        Your wallet address <strong>${followerAddress}</strong> has successfully configured notification settings.
      </p>
      <p style="font-size: 14px; line-height: 1.6; color: #a1a1aa;">
        You will receive real-time updates when your deployed copy-trading agents open or settle virtual positions on Mantle Sepolia Testnet.
      </p>
      <div style="margin: 30px 0; background-color: #141414; border: 1px solid #27272a; padding: 15px; border-radius: 8px;">
        <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #71717a; display: block; margin-bottom: 4px;">Registered Wallet</span>
        <code style="font-family: monospace; font-size: 13.5px; color: #8B5CF6;">${followerAddress}</code>
      </div>
      <p style="font-size: 12px; color: #52525b; border-top: 1px solid #27272a; padding-top: 15px; margin-top: 30px;">
        Aether is built on Mantle Sepolia Testnet. All assets, including aUSD and MNT, are simulated.
      </p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        html,
      }),
    });

    if (res.ok) {
      console.log(`[email] Welcome email successfully sent via Resend to: ${email}`);
      return true;
    } else {
      const errorText = await res.text();
      console.error(
        `[email] Resend API error (status ${res.status}):`,
        errorText
      );
      return false;
    }
  } catch (err) {
    console.error('[email] Failed to dispatch email via Resend:', err);
    return false;
  }
}

export async function sendTradeOpenedEmail(
  email: string,
  details: {
    leader:        string;
    token:         string | null;
    ausdAllocated: number | null;
    entryPrice:    number | null;
    txHash:        string | null;
  }
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('[email] Resend API key is missing. Skipping trade-opened email.');
    return false;
  }

  const from    = 'Aether Copy Trading <onboarding@resend.dev>';
  const leader  = `${details.leader.slice(0, 6)}…${details.leader.slice(-4)}`;
  const token   = details.token ?? 'a new asset';
  const subject = `Your agent opened a ${token} position`;

  const explorerLink = details.txHash
    ? `<p style="font-size: 13px;"><a href="https://mantlescan.xyz/tx/${details.txHash}" style="color: #8B5CF6;">View transaction on explorer →</a></p>`
    : '';

  const html = `
    <div style="font-family: sans-serif; background-color: #0d0d0d; color: #ffffff; padding: 40px 20px; border-radius: 12px; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #8B5CF6; font-weight: 300; border-bottom: 1px solid #27272a; padding-bottom: 12px; margin-bottom: 20px;">Position opened</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #a1a1aa;">
        Your agent just copied a trade from <strong>${leader}</strong> and opened a new <strong>${token}</strong> position.
      </p>
      <div style="margin: 30px 0; background-color: #141414; border: 1px solid #27272a; padding: 15px; border-radius: 8px;">
        <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #71717a; display: block; margin-bottom: 4px;">Allocated</span>
        <code style="font-family: monospace; font-size: 13.5px; color: #8B5CF6;">${details.ausdAllocated != null ? `${details.ausdAllocated.toFixed(2)} aUSD` : '—'}</code>
        <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #71717a; display: block; margin: 12px 0 4px;">Entry price</span>
        <code style="font-family: monospace; font-size: 13.5px; color: #8B5CF6;">${details.entryPrice != null ? `$${details.entryPrice.toFixed(4)}` : '—'}</code>
      </div>
      ${explorerLink}
      <p style="font-size: 12px; color: #52525b; border-top: 1px solid #27272a; padding-top: 15px; margin-top: 30px;">
        Aether is built on Mantle Sepolia Testnet. All assets, including aUSD and MNT, are simulated. Manage your notification preferences from your profile.
      </p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to: [email], subject, html }),
    });

    if (res.ok) {
      console.log(`[email] Trade-opened email successfully sent via Resend to: ${email}`);
      return true;
    } else {
      const errorText = await res.text();
      console.error(`[email] Resend API error (status ${res.status}):`, errorText);
      return false;
    }
  } catch (err) {
    console.error('[email] Failed to dispatch trade-opened email via Resend:', err);
    return false;
  }
}

export async function sendVerificationCode(
  email: string,
  code: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('[email] Resend API key is missing. Skipping verification email.');
    return false;
  }

  const from = 'Aether Copy Trading <onboarding@resend.dev>';
  const subject = `${code} is your Aether verification code`;

  const html = `
    <div style="font-family: sans-serif; background-color: #0d0d0d; color: #ffffff; padding: 40px 20px; border-radius: 12px; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #8B5CF6; font-weight: 300; border-bottom: 1px solid #27272a; padding-bottom: 12px; margin-bottom: 20px;">Verify your email</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #a1a1aa;">
        Enter the code below in Aether to confirm this email address. It expires in 10 minutes.
      </p>
      <div style="margin: 30px 0; background-color: #141414; border: 1px solid #27272a; padding: 18px; border-radius: 8px; text-align: center;">
        <span style="font-family: monospace; font-size: 28px; letter-spacing: 0.3em; color: #8B5CF6;">${code}</span>
      </div>
      <p style="font-size: 12px; color: #52525b; border-top: 1px solid #27272a; padding-top: 15px; margin-top: 30px;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        html,
      }),
    });

    if (res.ok) {
      console.log(`[email] Verification code sent via Resend to: ${email}`);
      return true;
    } else {
      const errorText = await res.text();
      console.error(
        `[email] Resend API error (status ${res.status}):`,
        errorText
      );
      return false;
    }
  } catch (err) {
    console.error('[email] Failed to dispatch verification email via Resend:', err);
    return false;
  }
}
