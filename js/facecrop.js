// Cutting a face square out of a camera picture (used by the PC's webcam and by the
// camera phone, so it has no other imports).
const SIZE = 160;                      // pixels, square

export function crop(src, w, h, box) {
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const side = box.s * h, x = box.cx * w - side / 2, y = box.cy * h - side / 2;
  const c = cv.getContext('2d');
  c.translate(SIZE, 0); c.scale(-1, 1);                              // mirrored, like the players see themselves
  c.drawImage(src, x, y, side, side, 0, 0, SIZE, SIZE);
  return cv.toDataURL('image/jpeg', 0.82);
}

// the phone side: cut the squares out of the picture the people were found in
export function cropFaces(src, boxes) {
  return boxes.map((b) => (b ? crop(src, src.width, src.height, b) : null));
}
