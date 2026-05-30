export const sizingInputInfo: Record<string, string> = {
  "Aspect ratio": "Span squared divided by wing area. Clamped from 2.2 to 12 before sizing.",
  "Cruise speed": "Target fixed-wing cruise speed in knots. Also nudges disk-loading and airfoil guesses.",
  "Endurance": "Cruise time before reserve. Also biases rotor disk loading toward larger rotors for long missions.",
  "G-rating": "Structural load target from 2G to 6G. 2G covers a 60deg bank turn, 4G is aerobatic, 6G is extreme.",
  "Hover allowance": "Hover/takeoff/landing time added to battery energy. It does not change tail sizing.",
  "Length ratio": "Total length divided by overall width. Width is currently wingspan because the sizing draft keeps rotors inside the wing span.",
  "Payload": "Useful load carried by the aircraft. Minimum sizing value is 0.1 kg.",
  "Reserve": "Battery percentage still in the pack at landing. 10% reserve means mission energy uses only 90% of installed energy.",
  "Rotor blades": "Only 2, 3, or 4. More blades reduce suggested diameter but lower hover figure of merit and add rotor mass.",
  "Takeoff T/W": "Vertical thrust target. Used directly for rotor thrust and takeoff power; minimum is 0.1.",
  "Target cruise CL": "Chosen cruise lift coefficient. Clamped 0.25 to 1.4 and directly drives wing area.",
};
