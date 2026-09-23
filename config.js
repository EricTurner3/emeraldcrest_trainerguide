
export const CONFIG = { 
    SPRITE_URL: (name) =>`sprites/${name.toUpperCase().replace('-', '_').replace(' ', '_').replace('%20', '_')}.png`,
    ITEM_SPRITE_BASE: 'sprites/item/',   // wherever your items folder is (keep the trailing slash)
    ITEM_SPRITE_EXT: '.png' 
};
