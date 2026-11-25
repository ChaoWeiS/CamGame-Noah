// Flappy Ark — flap your arms to fly through the ventilation gaps inside the ark.
import { FlightScene } from './flight.js';
class FlappyScene extends FlightScene { static KEY = 'Flappy'; constructor() { super('Flappy', 'ark'); } }
export default { scenes: [FlappyScene], start: 'Flappy' };
