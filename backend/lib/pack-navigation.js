export function findPackLink(links, siteUrl) {
  const origin = new URL(siteUrl).origin;
  for (const link of links) {
    if (!link.visible || !/^(paquets|packs|boosters)$/i.test(String(link.label || '').trim())) continue;
    try {
      const url = new URL(link.href, siteUrl);
      if (url.origin === origin && ['https:', 'http:'].includes(url.protocol)) return url.href;
    } catch {}
  }
  return null;
}
