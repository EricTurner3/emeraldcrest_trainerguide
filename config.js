// Optional sprite hook. Return an image URL for a Pokemon, or null for none.
//   name = Dex name, e.g. "Geodude-A"     species = game constant, e.g. "SPECIES_GEODUDE_ALOLAN"
// Example: SPRITE_URL: (name) => `sprites/${name.toLowerCase().replace(/[^a-z0-9-]/g, '')}.png`,
export const CONFIG = { 
    SPRITE_URL: (name) =>`sprites/${name.toUpperCase().replace('-', '_')}.png`,
    ITEM_SPRITE_BASE: 'sprites/item/',   // wherever your items folder is (keep the trailing slash)
    ITEM_SPRITE_EXT: '.png' 
};
