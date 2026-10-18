// Bank directory keyed by country. Each entry maps common banks to their
// SWIFT/BIC codes so a UI can auto-fill the SWIFT field when the user picks
// a known bank. Coverage focuses on countries most relevant to Saudi
// productions plus major regional/international payors. Users can always
// pick "Other" to type a bank manually — no SWIFT is auto-filled in that case.

export type BankEntry = { name: string; swift: string };

export const BANKS_BY_COUNTRY: Record<string, BankEntry[]> = {
  "Saudi Arabia": [
    { name: "Al Rajhi Bank", swift: "RJHISARI" },
    { name: "Saudi National Bank (SNB)", swift: "NCBKSAJE" },
    { name: "Riyad Bank", swift: "RIBLSARI" },
    { name: "Banque Saudi Fransi", swift: "BSFRSARI" },
    { name: "Arab National Bank (ANB)", swift: "ARNBSARI" },
    { name: "Saudi Investment Bank (SAIB)", swift: "SIBCSARI" },
    { name: "Bank AlJazira", swift: "BJAZSAJE" },
    { name: "Bank Albilad", swift: "ALBISARI" },
    { name: "Alinma Bank", swift: "INMASARI" },
    { name: "Saudi Awwal Bank (SAB)", swift: "SABBSARI" },
    { name: "Emirates NBD - KSA", swift: "EBILSARI" },
    { name: "Gulf International Bank - KSA", swift: "GULFSARI" },
    { name: "First Abu Dhabi Bank - KSA", swift: "NBADSARI" },
    { name: "BNP Paribas - KSA", swift: "BNPASARI" },
    { name: "J.P. Morgan Chase - KSA", swift: "CHASSARI" },
    { name: "Deutsche Bank - KSA", swift: "DEUTSARI" },
    { name: "National Bank of Bahrain - KSA", swift: "NBOBSARI" },
    { name: "STC Pay", swift: "" },
    { name: "urpay", swift: "" },
  ],
  "United Arab Emirates": [
    { name: "Emirates NBD", swift: "EBILAEAD" },
    { name: "First Abu Dhabi Bank (FAB)", swift: "NBADAEAA" },
    { name: "Abu Dhabi Commercial Bank (ADCB)", swift: "ADCBAEAA" },
    { name: "Dubai Islamic Bank", swift: "DUIBAEAD" },
    { name: "Mashreq Bank", swift: "BOMLAEAD" },
    { name: "HSBC UAE", swift: "BBMEAEAD" },
    { name: "RAKBank", swift: "NRAKAEAK" },
    { name: "Commercial Bank of Dubai", swift: "CBDUAEAD" },
    { name: "Abu Dhabi Islamic Bank (ADIB)", swift: "ABDIAEAD" },
    { name: "Sharjah Islamic Bank", swift: "NBSHAEAS" },
    { name: "Ajman Bank", swift: "AJMBAEAJ" },
    { name: "National Bank of Fujairah", swift: "NBFUAEAF" },
    { name: "Emirates Islamic Bank", swift: "MEBLAEAD" },
    { name: "Wio Bank", swift: "" },
  ],
  Bahrain: [
    { name: "National Bank of Bahrain", swift: "NBOBBHBM" },
    { name: "Ahli United Bank", swift: "AUBBBHBM" },
    { name: "Bank of Bahrain and Kuwait", swift: "BBKUBHBM" },
    { name: "HSBC Bahrain", swift: "BBMEBHBX" },
    { name: "Gulf International Bank", swift: "GULFBHBM" },
    { name: "Al Salam Bank", swift: "ALSABHBM" },
    { name: "Bahrain Islamic Bank (BisB)", swift: "BIBBBHBM" },
    { name: "Khaleeji Commercial Bank", swift: "KHCBBHBM" },
    { name: "Ithmaar Bank", swift: "SHIBBHBM" },
  ],
  Kuwait: [
    { name: "National Bank of Kuwait", swift: "NBOKKWKW" },
    { name: "Kuwait Finance House", swift: "KFHOKWKW" },
    { name: "Gulf Bank", swift: "GULBKWKW" },
    { name: "Commercial Bank of Kuwait", swift: "COMBKWKW" },
    { name: "Boubyan Bank", swift: "BBYNKWKW" },
    { name: "Burgan Bank", swift: "BRGNKWKW" },
    { name: "Warba Bank", swift: "WRBAKWKW" },
    { name: "Ahli United Bank - Kuwait", swift: "BKMEKWKW" },
    { name: "Kuwait International Bank", swift: "KIBKKWKW" },
  ],
  Qatar: [
    { name: "Qatar National Bank (QNB)", swift: "QNBAQAQA" },
    { name: "Commercial Bank of Qatar", swift: "CBQAQAQA" },
    { name: "Doha Bank", swift: "DOHBQAQA" },
    { name: "Qatar Islamic Bank", swift: "QISBQAQA" },
    { name: "Masraf Al Rayan", swift: "MAFRQAQA" },
    { name: "Dukhan Bank", swift: "BKINQAQA" },
    { name: "Qatar International Islamic Bank (QIIB)", swift: "QIIBQAQA" },
    { name: "Ahli Bank Qatar", swift: "ABQQQAQA" },
  ],
  Oman: [
    { name: "Bank Muscat", swift: "BMUSOMRX" },
    { name: "National Bank of Oman", swift: "NBOMOMRX" },
    { name: "Bank Dhofar", swift: "BDOFOMRX" },
    { name: "HSBC Oman", swift: "BBMEOMRX" },
    { name: "Sohar International", swift: "BSHROMRU" },
    { name: "Ahli Bank Oman", swift: "AUBOOMRU" },
    { name: "Bank Nizwa", swift: "BNZWOMRX" },
    { name: "Oman Arab Bank", swift: "OMABOMRU" },
  ],
  Jordan: [
    { name: "Arab Bank", swift: "ARABJOAX" },
    { name: "Bank of Jordan", swift: "BJORJOAX" },
    { name: "Housing Bank for Trade and Finance", swift: "HBHOJOAX" },
    { name: "Jordan Kuwait Bank", swift: "JKBAJOAM" },
  ],
  Egypt: [
    { name: "National Bank of Egypt", swift: "NBEGEGCX" },
    { name: "Banque Misr", swift: "BMISEGCX" },
    { name: "Commercial International Bank (CIB)", swift: "CIBEEGCX" },
    { name: "QNB Alahli", swift: "QNBAEGCX" },
    { name: "HSBC Egypt", swift: "EBBKEGCX" },
  ],
  Lebanon: [
    { name: "Bank Audi", swift: "AUDBLBBX" },
    { name: "BLOM Bank", swift: "BLOMLBBX" },
    { name: "Byblos Bank", swift: "BYBALBBX" },
    { name: "Fransabank", swift: "FSABLBBX" },
  ],
  Turkey: [
    { name: "Ziraat Bankası", swift: "TCZBTR2A" },
    { name: "İş Bankası", swift: "ISBKTRIS" },
    { name: "Garanti BBVA", swift: "TGBATRIS" },
    { name: "Akbank", swift: "AKBKTRIS" },
    { name: "Yapı Kredi", swift: "YAPITRIS" },
  ],
  "United Kingdom": [
    { name: "HSBC UK", swift: "HBUKGB4B" },
    { name: "Barclays", swift: "BARCGB22" },
    { name: "Lloyds Bank", swift: "LOYDGB2L" },
    { name: "NatWest", swift: "NWBKGB2L" },
    { name: "Standard Chartered", swift: "SCBLGB2L" },
    { name: "Santander UK", swift: "ABBYGB2L" },
    { name: "Revolut", swift: "REVOGB21" },
    { name: "Wise", swift: "TRWIGB22" },
  ],
  "United States": [
    { name: "JPMorgan Chase", swift: "CHASUS33" },
    { name: "Bank of America", swift: "BOFAUS3N" },
    { name: "Citibank", swift: "CITIUS33" },
    { name: "Wells Fargo", swift: "WFBIUS6S" },
    { name: "HSBC USA", swift: "MRMDUS33" },
    { name: "PNC Bank", swift: "PNCCUS33" },
  ],
  France: [
    { name: "BNP Paribas", swift: "BNPAFRPP" },
    { name: "Société Générale", swift: "SOGEFRPP" },
    { name: "Crédit Agricole", swift: "AGRIFRPP" },
    { name: "Crédit Mutuel", swift: "CMCIFRPA" },
    { name: "La Banque Postale", swift: "PSSTFRPP" },
  ],
  Germany: [
    { name: "Deutsche Bank", swift: "DEUTDEFF" },
    { name: "Commerzbank", swift: "COBADEFF" },
    { name: "DZ Bank", swift: "GENODEFF" },
    { name: "N26", swift: "NTSBDEB1" },
  ],
  India: [
    { name: "State Bank of India", swift: "SBININBB" },
    { name: "HDFC Bank", swift: "HDFCINBB" },
    { name: "ICICI Bank", swift: "ICICINBB" },
    { name: "Axis Bank", swift: "AXISINBB" },
    { name: "Kotak Mahindra Bank", swift: "KKBKINBB" },
  ],
  Pakistan: [
    { name: "Habib Bank Limited (HBL)", swift: "HABBPKKA" },
    { name: "United Bank Limited (UBL)", swift: "UNILPKKA" },
    { name: "MCB Bank", swift: "MUCBPKKA" },
    { name: "Meezan Bank", swift: "MEZNPKKA" },
    { name: "Bank Alfalah", swift: "ALFHPKKA" },
  ],
  Philippines: [
    { name: "BDO Unibank", swift: "BNORPHMM" },
    { name: "Bank of the Philippine Islands (BPI)", swift: "BOPIPHMM" },
    { name: "Metrobank", swift: "MBTCPHMM" },
    { name: "Landbank", swift: "TLBPPHMM" },
  ],
};

/** Returns the bank list for a country plus a stable "Other" sentinel. */
export const OTHER_BANK = "__other__";
export function banksForCountry(country: string | null | undefined): BankEntry[] {
  if (!country) return [];
  return BANKS_BY_COUNTRY[country] ?? [];
}
export function swiftForBank(
  country: string | null | undefined,
  bankName: string | null | undefined,
): string {
  if (!country || !bankName) return "";
  const list = banksForCountry(country);
  const hit = list.find((b) => b.name.toLowerCase() === bankName.trim().toLowerCase());
  return hit?.swift ?? "";
}
