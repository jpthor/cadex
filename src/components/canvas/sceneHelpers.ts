import * as THREE from "three";


export function createOriginReferenceGroup() {
  const group = new THREE.Group();
  group.name = "Origin references";
  group.add(createOriginPlane("XY", "#38bdf8", new THREE.Euler(0, 0, 0), new THREE.Vector3(0.23, 0.23, 0.002)));
  group.add(createOriginPlane("XZ", "#22c55e", new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0.23, 0.002, 0.23)));
  group.add(createOriginPlane("YZ", "#f97316", new THREE.Euler(0, Math.PI / 2, 0), new THREE.Vector3(0.002, 0.23, 0.23)));
  group.add(createAxisArrow("X", new THREE.Vector3(1, 0, 0), "#ef4444"));
  group.add(createAxisArrow("Y", new THREE.Vector3(0, 1, 0), "#22c55e"));
  group.add(createAxisArrow("Z", new THREE.Vector3(0, 0, 1), "#3b82f6"));
  return group;
}

export function createOriginPlane(label: string, color: string, rotation: THREE.Euler, labelPosition: THREE.Vector3) {
  const group = new THREE.Group();
  group.name = `${label} origin plane`;
  const geometry = new THREE.PlaneGeometry(0.42, 0.42);
  const material = new THREE.MeshBasicMaterial({
    color,
    depthWrite: false,
    opacity: 0.12,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.name = `${label} origin plane`;
  plane.rotation.copy(rotation);
  plane.renderOrder = -1;
  plane.userData.cadObject = {
    id: `origin-plane-${label.toLowerCase()}`,
    name: `${label} origin plane`,
    kind: "reference",
    referenceKind: "plane",
  };
  group.add(plane);

  const half = 0.42 / 2;
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, -half, 0),
      new THREE.Vector3(half, -half, 0),
      new THREE.Vector3(half, half, 0),
      new THREE.Vector3(-half, half, 0),
    ]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.52 }),
  );
  outline.rotation.copy(rotation);
  outline.raycast = () => undefined;
  group.add(outline);

  const sprite = createTextSprite(label, color);
  sprite.position.copy(labelPosition);
  sprite.scale.set(0.085, 0.04, 1);
  sprite.raycast = () => undefined;
  group.add(sprite);
  return group;
}

export function createAxisArrow(label: string, direction: THREE.Vector3, color: string) {
  const group = new THREE.Group();
  const normalized = direction.clone().normalize();
  const arrow = new THREE.ArrowHelper(normalized, new THREE.Vector3(0, 0, 0), 0.34, color, 0.05, 0.022);
  group.add(arrow);

  const sprite = createTextSprite(label, color);
  sprite.position.copy(normalized.multiplyScalar(0.39));
  sprite.scale.set(0.07, 0.04, 1);
  group.add(sprite);
  return group;
}

export function createTextSprite(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(15, 23, 32, 0.78)";
    roundRect(context, 10, 10, 108, 44, 8);
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 3;
    roundRect(context, 10, 10, 108, 44, 8);
    context.stroke();
    context.fillStyle = "#f8fafc";
    context.font = "700 28px Inter, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 64, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 8;
  return sprite;
}

export function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
