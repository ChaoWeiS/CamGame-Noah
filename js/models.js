// Where the four animals' 3D models live (part of the base: every game can use them).
// Detailed models on the big screen (assets/models/hd, ~7 MB each, look like the originals);
// the light ones (~3-4 MB) in phone mode. Add ?models=lite or ?models=hd to choose.
import { LITE } from './mode.js';

const MODEL_DIR = (new URLSearchParams(location.search).get('models') || (LITE ? 'lite' : 'hd')) === 'lite' ? 'assets/models/' : 'assets/models/hd/';
export const MODELS = {
  bear: MODEL_DIR + 'bear_tripo.glb',
  hamster: MODEL_DIR + 'hamster.glb',
  chicken: MODEL_DIR + 'chicken.glb',
  dog: MODEL_DIR + 'dog.glb',
};
