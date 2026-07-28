// Brief, ASCII-only reference for common MITRE ATT&CK (Enterprise) techniques,
// used to show a tooltip on each technique. We store only the code, so this
// static lookup provides the name + description for display. Not exhaustive;
// unknown codes fall back to the parent technique, then a generic label.

export type TechniqueInfo = { name: string; description: string };

export const TECHNIQUES: Record<string, TechniqueInfo> = {
  T1003: { name: "OS Credential Dumping", description: "Extracts account credentials from the operating system or memory." },
  T1005: { name: "Data from Local System", description: "Collects data from the local host prior to exfiltration." },
  T1010: { name: "Application Window Discovery", description: "Lists open application windows to learn what software is in use." },
  T1016: { name: "System Network Configuration Discovery", description: "Gathers network configuration details of a system." },
  T1021: { name: "Remote Services", description: "Moves laterally by logging into remote services with valid accounts." },
  T1027: { name: "Obfuscated Files or Information", description: "Encodes, encrypts or obfuscates files to hinder analysis and detection." },
  T1033: { name: "System Owner/User Discovery", description: "Identifies the primary user or logged-in accounts on a system." },
  T1036: { name: "Masquerading", description: "Manipulates names or locations of objects to appear legitimate and evade defenses." },
  "T1036.005": { name: "Match Legitimate Name or Location", description: "Names malware after, or places it alongside, legitimate files to blend in." },
  T1041: { name: "Exfiltration Over C2 Channel", description: "Steals data by sending it over the existing command-and-control channel." },
  T1049: { name: "System Network Connections Discovery", description: "Lists active network connections on a system." },
  T1053: { name: "Scheduled Task/Job", description: "Uses task schedulers to run malicious code, often for persistence." },
  T1055: { name: "Process Injection", description: "Injects code into another process to evade defenses and elevate privileges." },
  T1057: { name: "Process Discovery", description: "Enumerates running processes on a system." },
  T1059: { name: "Command and Scripting Interpreter", description: "Executes commands and scripts via interpreters such as PowerShell or bash." },
  "T1059.001": { name: "PowerShell", description: "Uses PowerShell to execute commands and scripts." },
  "T1059.003": { name: "Windows Command Shell", description: "Uses cmd.exe to execute commands and scripts." },
  T1068: { name: "Exploitation for Privilege Escalation", description: "Exploits a software vulnerability to elevate privileges." },
  T1071: { name: "Application Layer Protocol", description: "Communicates using standard application-layer protocols to blend with normal traffic." },
  "T1071.001": { name: "Web Protocols", description: "Uses HTTP/HTTPS for command and control." },
  T1078: { name: "Valid Accounts", description: "Uses legitimate credentials to gain and maintain access." },
  T1082: { name: "System Information Discovery", description: "Gathers details about the operating system and hardware." },
  T1087: { name: "Account Discovery", description: "Enumerates accounts on a system or network." },
  T1090: { name: "Proxy", description: "Routes traffic through intermediary systems to obscure its origin." },
  "T1090.004": { name: "Domain Fronting", description: "Hides the true destination of traffic behind a trusted domain." },
  T1095: { name: "Non-Application Layer Protocol", description: "Uses non-application-layer protocols for command and control." },
  T1102: { name: "Web Service", description: "Uses legitimate web services for command and control." },
  T1105: { name: "Ingress Tool Transfer", description: "Transfers additional tools or files onto a compromised system." },
  T1106: { name: "Native API", description: "Invokes operating-system API functions to execute behaviors." },
  T1112: { name: "Modify Registry", description: "Changes Windows Registry keys to configure or hide activity." },
  T1113: { name: "Screen Capture", description: "Takes screenshots of the victim's display." },
  T1133: { name: "External Remote Services", description: "Uses external remote services like VPNs to access a network." },
  T1140: { name: "Deobfuscate/Decode Files or Information", description: "Decodes or decrypts obfuscated data or payloads at runtime." },
  T1190: { name: "Exploit Public-Facing Application", description: "Exploits an internet-facing application to gain initial access." },
  T1204: { name: "User Execution", description: "Relies on a user to run a malicious file or link." },
  T1219: { name: "Remote Access Software", description: "Abuses legitimate remote-access tools to control a system." },
  T1486: { name: "Data Encrypted for Impact", description: "Encrypts data to disrupt availability (ransomware)." },
  T1490: { name: "Inhibit System Recovery", description: "Deletes backups or recovery options to prevent restoration." },
  T1497: { name: "Virtualization/Sandbox Evasion", description: "Detects analysis environments and alters behavior to evade them." },
  T1518: { name: "Software Discovery", description: "Enumerates installed software, including security tools." },
  T1543: { name: "Create or Modify System Process", description: "Creates or modifies services or daemons for persistence." },
  T1547: { name: "Boot or Logon Autostart Execution", description: "Configures autostart mechanisms to persist across reboots and logons." },
  T1560: { name: "Archive Collected Data", description: "Compresses or encrypts collected data to prepare it for exfiltration." },
  T1566: { name: "Phishing", description: "Sends fraudulent messages to trick users into revealing information or running malicious content." },
  "T1566.001": { name: "Spearphishing Attachment", description: "Phishing that delivers a malicious file attachment to the victim." },
  "T1566.002": { name: "Spearphishing Link", description: "Phishing that lures the victim to click a malicious link." },
  T1567: { name: "Exfiltration Over Web Service", description: "Exfiltrates data to an external web service." },
  T1572: { name: "Protocol Tunneling", description: "Tunnels network traffic within another protocol to evade detection." },
  T1574: { name: "Hijack Execution Flow", description: "Hijacks how programs load code in order to run malicious payloads." },
  "T1574.001": { name: "DLL Search Order Hijacking", description: "Plants a malicious DLL where a program loads it before the legitimate one." },
};

/** Look up a technique, falling back to the parent technique for sub-techniques. */
export function techniqueInfo(code: string): TechniqueInfo | null {
  if (TECHNIQUES[code]) return TECHNIQUES[code];
  const dot = code.indexOf(".");
  if (dot > 0 && TECHNIQUES[code.slice(0, dot)]) return TECHNIQUES[code.slice(0, dot)];
  return null;
}

/** Tooltip text for a technique code: "Name - description", or a generic label. */
export function techniqueTooltip(code: string): string {
  const info = techniqueInfo(code);
  return info ? `${info.name} - ${info.description}` : `MITRE ATT&CK technique ${code}`;
}
