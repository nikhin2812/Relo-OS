// MVP item 5: provider options per service, and what choosing one would cost.

export type RateBasis = "per_family" | "per_person";

export type VendorRate = {
  vendor_id: string;
  category: string;
  rate: number;
  rate_basis: RateBasis;
  description: string;
};

export type Vendor = { id: string; name: string; city: string };

export type ProviderOption = {
  vendorId: string;
  vendorName: string;
  city: string;
  description: string;
  cost: number;
  overCap: boolean;
};

// What the family would pay under this rate. Mirrors select_service_provider in the database.
export function agreedCost(rate: number, basis: RateBasis, familySize: number): number {
  const paise = Math.round(Number(rate) * 100) * (basis === "per_person" ? familySize : 1);
  return paise / 100;
}

// Vendors offering this service category, cheapest first, flagged when above the policy cap.
export function providerOptions(
  category: string,
  rates: VendorRate[],
  vendors: Vendor[],
  familySize: number,
  cap: number | null,
): ProviderOption[] {
  const byId = new Map(vendors.map((v) => [v.id, v]));
  return rates
    .filter((r) => r.category === category && byId.has(r.vendor_id))
    .map((r) => {
      const v = byId.get(r.vendor_id)!;
      const cost = agreedCost(r.rate, r.rate_basis, familySize);
      return {
        vendorId: v.id,
        vendorName: v.name,
        city: v.city,
        description: r.description,
        cost,
        overCap: cap !== null && cost > cap,
      };
    })
    .sort((a, b) => a.cost - b.cost || a.vendorName.localeCompare(b.vendorName));
}
