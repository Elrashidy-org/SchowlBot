// Schowl brand palette (from the website's tailwind config).
const NAVY = "#0C4160"; // primary
const INK = "#071330"; // secondary (darkest)
const CYAN = "#00B5B5"; // signature accent
const TEAL_DARK = "#00A3A3";
const SEMI_DARK = "#738FA7"; // muted text
const PAGE_BG = "#EEF2F7";
const BORDER = "#E4E8F0";
const FONT = "'Cairo','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Turn bare URLs into styled links (input is already HTML-escaped).
function autolink(value: string) {
  return value.replace(
    /(https?:\/\/[^\s<]+)/g,
    `<a href="$1" style="color:${TEAL_DARK};text-decoration:none;font-weight:700;">$1</a>`,
  );
}

export function renderBrandedEmail(input: {
  subject?: string | null;
  body: string;
  language?: string | null;
  logoUrl?: string | null;
  headerStyle?: "light" | "dark";
  courses?: { name: string; ageText?: string; url?: string }[];
  coursesUrl?: string;
  unsubscribeUrl?: string;
}) {
  const dark = input.headerStyle === "dark";
  const rtl = input.language === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";

  const paragraphs = input.body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        `<p style="margin:0 0 16px;color:${INK};font-size:16px;line-height:1.7;text-align:${align};">${autolink(
          escapeHtml(line),
        )}</p>`,
    )
    .join("");

  const heading = input.subject
    ? `<h1 style="margin:0 0 22px;color:${NAVY};font-size:22px;font-weight:800;text-align:${align};">${escapeHtml(
        input.subject,
      )}</h1>`
    : "";

  const logoHeight = dark ? 56 : 48;
  const logo = input.logoUrl
    ? `<img src="${input.logoUrl}" alt="Schowl" height="${logoHeight}" style="height:${logoHeight}px;width:auto;border:0;display:inline-block;">`
    : `<span style="font-size:26px;font-weight:800;letter-spacing:0.5px;color:${dark ? "#FFFFFF" : NAVY};">Schowl<span style="color:${CYAN};">.</span></span>`;

  const header = dark
    ? `<tr><td style="background:${INK};background-image:linear-gradient(135deg,#0A4D68 0%,${CYAN} 100%);padding:28px 32px;text-align:center;">${logo}</td></tr>`
    : `<tr><td style="background:#FFFFFF;padding:26px 32px 18px;text-align:center;">${logo}</td></tr>
        <tr><td style="height:4px;background:${CYAN};line-height:4px;font-size:0;">&nbsp;</td></tr>`;

  const preheader = input.subject ? escapeHtml(input.subject) : "Schowl";

  // Upsell: "Explore our courses" block.
  let coursesBlock = "";
  if (input.courses && input.courses.length) {
    const title = rtl ? "تصفّح كورساتنا" : "Explore our courses";
    const cta = rtl ? "شاهد كل الكورسات" : "Browse all courses";
    const items = input.courses
      .map((c) => {
        const nameHtml = c.url
          ? `<a href="${c.url}" style="color:${NAVY};font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(c.name)} &rsaquo;</a>`
          : `<span style="color:${NAVY};font-size:15px;font-weight:700;">${escapeHtml(c.name)}</span>`;
        return `<tr>
            <td style="padding:10px 14px;border:1px solid ${BORDER};border-radius:10px;background:#F8FAFC;" dir="${dir}">
              ${nameHtml}${
                c.ageText
                  ? `<br><span style="color:${SEMI_DARK};font-size:12px;">${escapeHtml(c.ageText)}</span>`
                  : ""
              }
            </td>
          </tr>
          <tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>`;
      })
      .join("");
    const button = input.coursesUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px auto 0;"><tr><td style="border-radius:10px;background:${CYAN};">
          <a href="${input.coursesUrl}" style="display:inline-block;padding:12px 26px;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">${cta} →</a>
        </td></tr></table>`
      : "";
    coursesBlock = `
        <tr><td style="padding:0 32px;"><div style="border-top:1px solid ${BORDER};"></div></td></tr>
        <tr>
          <td style="padding:24px 32px 4px;" dir="${dir}">
            <h2 style="margin:0 0 16px;color:${NAVY};font-size:18px;font-weight:800;text-align:${align};">${title}</h2>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
            ${button}
          </td>
        </tr>`;
  }

  return `<!doctype html>
<html dir="${dir}" lang="${rtl ? "ar" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:${FONT};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#FFFFFF;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;font-family:${FONT};">
        ${header}
        <tr>
          <td style="padding:32px 32px 24px;" dir="${dir}">
            ${heading}
            ${paragraphs}
          </td>
        </tr>
        ${coursesBlock}
        <tr><td style="height:8px;"></td></tr>
        <tr>
          <td style="background:${INK};padding:22px 32px;text-align:center;color:#AFC0D4;font-size:12px;line-height:1.6;font-family:${FONT};">
            <span style="color:#FFFFFF;font-weight:700;">Schowl</span> — online courses that build creators, not just consumers.<br>
            This is an automated message; please don't reply to this email.${
              input.unsubscribeUrl
                ? `<br><a href="${input.unsubscribeUrl}" style="color:#AFC0D4;text-decoration:underline;">Unsubscribe</a>`
                : ""
            }
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
