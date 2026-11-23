# Cut each character's T-pose into a 2D puppet: body (with head), 2 arms, 2 legs + pivots.
import json, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
SRC = '/home/claude/camgame-noah/assets/characters'
OUT = '/home/claude/camgame-noah/assets/puppets'
NAMES = ['bear','dog','cat','lizard','chicken','mouse','hamster','pine']

def segments(row):
    s, inside = [], False
    for x, v in enumerate(row):
        if v and not inside: start, inside = x, True
        if not v and inside: s.append((start, x - 1)); inside = False
    if inside: s.append((start, len(row) - 1))
    return s

rig = {}
for n in NAMES:
    img = np.array(Image.open(f'{SRC}/{n}_tpose.png').convert('RGBA'))
    a = img[..., 3] > 60
    h, w = a.shape
    widths = a.sum(axis=1)
    ya = int(np.argmax(widths))
    # arm band: contiguous rows around ya that are much wider than the torso
    thr = 0.7 * widths[ya]
    y1 = ya
    while y1 > 0 and widths[y1 - 1] > thr: y1 -= 1
    y2 = ya
    while y2 < h - 1 and widths[y2 + 1] > thr: y2 += 1
    cx = w / 2
    # torso edges just below the arms: the segment containing the centre
    def torso_at(y):
        for s0, s1 in segments(a[min(h - 1, y)]):
            if s0 <= cx <= s1: return s0, s1
        return None
    probe = min(h - 1, y2 + max(6, int(0.05 * h)))
    tl, tr = torso_at(probe) or (int(cx - 40), int(cx + 40))
    tw = tr - tl
    inset = 0  # no overlap patch: arms are drawn in front of the body
    armY = (y1 + y2) / 2
    # rows an arm may occupy (paws can droop a bit)
    ry0, ry1 = max(0, y1 - int(0.025 * h)), min(h, y2 + int(0.05 * h))
    yy, xx = np.mgrid[0:h, 0:w]
    band = (yy >= ry0) & (yy < ry1)
    lab, k = ndimage.label(a & band & (xx < tl))
    leftArm = np.zeros_like(a)
    if k:
        # keep the component reaching furthest left
        best = min(range(1, k + 1), key=lambda i: xx[lab == i].min())
        leftArm = lab == best
    lab, k = ndimage.label(a & band & (xx > tr))
    rightArm = np.zeros_like(a)
    if k:
        best = max(range(1, k + 1), key=lambda i: xx[lab == i].max())
        rightArm = lab == best
    # legs: find the crotch, the top of the gap between the two lowest blobs
    yc = h - 1
    for y in range(h - 1, int(h * 0.5), -1):
        segs = [s for s in segments(a[y]) if s[1] - s[0] > 2]
        if len(segs) >= 2 and segs[0][1] < cx < segs[-1][0] or (len(segs) >= 2 and segs[0][1] < segs[-1][0]):
            yc = y
        else:
            break
    below = a & (yy > yc)
    lab, k = ndimage.label(below)
    comps = [(xx[lab == i].mean(), i) for i in range(1, k + 1) if (lab == i).sum() > 30]
    comps.sort()
    leftLeg = lab == comps[0][1] if comps else np.zeros_like(a)
    rightLeg = lab == comps[-1][1] if len(comps) > 1 else np.zeros_like(a)
    # body = everything except the limbs
    body = a & ~leftArm & ~rightArm & ~leftLeg & ~rightLeg

    ov = max(6, int(0.04 * h))   # overlap so joints don't open gaps when limbs rotate
    def grow_into_body(limb, direction):
        # extend the limb a little into the body at its joint (body is drawn on top)
        m = limb.copy()
        if direction == 'left':  m |= a & band & (xx >= tl) & (xx < tl + inset)
        if direction == 'right': m |= a & band & (xx <= tr) & (xx > tr - inset)
        if direction == 'down':
            cols = np.nonzero(limb.any(axis=0))[0]
            if len(cols): m |= a & (yy > yc - ov) & (yy <= yc) & (xx >= cols.min()) & (xx <= cols.max())
        return m

    parts = {
        'body': (body, None),
        'armL': (leftArm, (tl + 0.03 * tw, armY)),
        'armR': (rightArm, (tr - 0.03 * tw, armY)),
        'legL': (grow_into_body(leftLeg, 'down'), None),
        'legR': (grow_into_body(rightLeg, 'down'), None),
    }
    info = {'w': w, 'h': h, 'parts': {}}
    for pname, (mask, pivot) in parts.items():
        if not mask.any(): continue
        ys, xs = np.nonzero(mask)
        x0, x1, y0, y1b = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        out = img.copy(); out[..., 3] = np.where(mask, img[..., 3], 0)
        Image.fromarray(out[y0:y1b, x0:x1]).save(f'{OUT}/{n}_{pname}.png', optimize=True)
        if pname.startswith('leg'):
            cols = np.nonzero(mask[min(h - 1, yc + 2)])[0]
            px = float(cols.mean()) if len(cols) else float(xs.mean())
            pivot = (px, yc - ov * 0.5)
        if pname == 'body': pivot = (cx, (armY + yc) / 2)
        info['parts'][pname] = {'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1b - y0),
                                'px': round(float(pivot[0]), 1), 'py': round(float(pivot[1]), 1)}
    # reference points in sprite pixels, used to scale the puppet to the player
    info['shoulderY'] = round(float(armY), 1)
    info['hipY'] = round(float(yc), 1)
    rig[n] = info
    # debug overlay
    dbg = Image.fromarray(img).convert('RGBA')
    over = Image.new('RGBA', dbg.size, (0, 0, 0, 0)); d = ImageDraw.Draw(over)
    colors = {'armL': (255, 0, 0, 110), 'armR': (0, 0, 255, 110), 'legL': (255, 160, 0, 110), 'legR': (0, 200, 0, 110)}
    for pname, col in colors.items():
        m = parts[pname][0]
        if m.any():
            ov_img = np.zeros((h, w, 4), np.uint8); ov_img[m] = col
            over = Image.alpha_composite(over, Image.fromarray(ov_img))
    d = ImageDraw.Draw(over)
    for pname, p in info['parts'].items():
        d.ellipse([p['px'] - 5, p['py'] - 5, p['px'] + 5, p['py'] + 5], fill=(255, 0, 255, 255))
    Image.alpha_composite(dbg, over).save(f'/home/claude/tests/rig_{n}.png')
    print(n, 'arms rows', y1, y2, 'torso', tl, tr, 'crotch', yc, 'parts', list(info['parts']))
json.dump(rig, open(f'{OUT}/rig.json', 'w'), indent=1)
