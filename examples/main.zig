const std = @import("std");

const Signal = struct {
    frequency: u32,
    detected: bool = false,
};

pub fn main() void {
    const signal = Signal{ .frequency = 1408 };
    std.debug.print("listening on {d} Hz…\n", .{signal.frequency});
    // keep your eyes on the code.
}
