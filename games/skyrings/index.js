// Sky Rings — fly over the flood through the rings, steering with your arms like a plane.
import { FlightScene } from '../flappy/flight.js';
class SkyScene extends FlightScene { static KEY = 'SkyRings'; constructor() { super('SkyRings', 'sky'); } }
export default { scenes: [SkyScene], start: 'SkyRings' };
