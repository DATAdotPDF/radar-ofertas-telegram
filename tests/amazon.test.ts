import { describe, expect, it } from "vitest";
import { amazonConfigurationState, parseAmazonItems } from "../src/amazon";
import type { Env, SourceConfig } from "../src/types";

const source: SourceConfig = {
  id: "amazon-br", tenant_id: "default", name: "Amazon Brasil", kind: "api", status: "active",
  policy_url: null, search_url_template: null, image_authorized: 1, notes: null
};

describe("Amazon Creators API", () => {
  it("normaliza preço, desconto, imagem e link associado", () => {
    const offers = parseAmazonItems(source, { searchResult: { items: [{
      asin: "B000TESTE",
      detailPageURL: "https://www.amazon.com.br/dp/B000TESTE?tag=radar-20",
      images: { primary: { large: { url: "https://m.media-amazon.com/image.jpg" } } },
      itemInfo: { title: { displayValue: "Zelda edição de colecionador" }, features: { displayValues: ["Mídia física", "Inclui steelbook"] } },
      offersV2: { listings: [{
        isBuyBoxWinner: true,
        availability: { type: "IN_STOCK" },
        condition: { value: "New" },
        merchantInfo: { name: "Amazon.com.br" },
        price: { money: { amount: 449.9 }, savingBasis: { money: { amount: 599.9 } }, savings: { percentage: 25 } }
      }] }
    }] } });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      externalId: "B000TESTE", priceCents: 44990, originalPriceCents: 59990, discountPercent: 25,
      imageAuthorized: true, officialStore: true, condition: "new", stockStatus: "in_stock"
    });
    expect(offers[0].url).toContain("tag=radar-20");
  });

  it("só marca a Amazon como configurada com as três credenciais", () => {
    expect(amazonConfigurationState({} as Env)).toBe("awaiting_credentials");
    expect(amazonConfigurationState({
      AMAZON_CREATORS_CREDENTIAL_ID: "id",
      AMAZON_CREATORS_CREDENTIAL_SECRET: "secret",
      AMAZON_ASSOCIATE_TAG: "tag"
    } as Env)).toBe("configured");
  });
});
