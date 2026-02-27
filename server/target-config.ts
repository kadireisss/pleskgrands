let targetHost = "grandpashabet7078.com";
let targetUrl = "https://grandpashabet7078.com";
let targetOrigin = "https://grandpashabet7078.com";

export function getTargetHost() { return targetHost; }
export function getTargetUrl() { return targetUrl; }
export function getTargetOrigin() { return targetOrigin; }

export function updateTargetDomain(domain: string) {
  targetHost = domain;
  targetUrl = `https://${domain}`;
  targetOrigin = `https://${domain}`;
  console.log(`[CONFIG] Target domain updated to: ${domain}`);
}
