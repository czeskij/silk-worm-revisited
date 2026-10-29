"""68000 disassembler with Amiga hardware register annotations.

usage: dis68k.py FILE START_OFFSET LENGTH LOAD_ADDR [--raw]
  START_OFFSET / LENGTH are byte positions inside FILE (hex ok: 0x...)
  LOAD_ADDR is the address the bytes sit at in Amiga memory.
"""
import re
import sys

import capstone

CUSTOM = {
    0x002: "DMACONR", 0x006: "VPOSR", 0x00A: "JOY0DAT", 0x00C: "JOY1DAT",
    0x010: "ADKCONR", 0x016: "POTGOR", 0x01A: "DSKBYTR", 0x01C: "INTENAR",
    0x01E: "INTREQR", 0x020: "DSKPTH", 0x024: "DSKLEN", 0x026: "DSKDAT",
    0x034: "POTGO", 0x040: "BLTCON0", 0x042: "BLTCON1", 0x044: "BLTAFWM",
    0x046: "BLTALWM", 0x048: "BLTCPTH", 0x04C: "BLTBPTH", 0x050: "BLTAPTH",
    0x054: "BLTDPTH", 0x058: "BLTSIZE", 0x064: "BLTAMOD", 0x066: "BLTDMOD",
    0x07E: "DSKSYNC", 0x080: "COP1LCH", 0x084: "COP2LCH", 0x088: "COPJMP1",
    0x08A: "COPJMP2", 0x08E: "DIWSTRT", 0x090: "DIWSTOP", 0x092: "DDFSTRT",
    0x094: "DDFSTOP", 0x096: "DMACON", 0x098: "CLXCON", 0x09A: "INTENA",
    0x09C: "INTREQ", 0x09E: "ADKCON", 0x0A0: "AUD0LCH", 0x0A4: "AUD0LEN",
    0x0A6: "AUD0PER", 0x0A8: "AUD0VOL", 0x0B0: "AUD1LCH", 0x0C0: "AUD2LCH",
    0x0D0: "AUD3LCH", 0x0E0: "BPL1PTH", 0x0E4: "BPL2PTH", 0x0E8: "BPL3PTH",
    0x0EC: "BPL4PTH", 0x0F0: "BPL5PTH", 0x0F4: "BPL6PTH", 0x100: "BPLCON0",
    0x102: "BPLCON1", 0x104: "BPLCON2", 0x108: "BPL1MOD", 0x10A: "BPL2MOD",
    0x120: "SPR0PTH", 0x180: "COLOR00", 0x182: "COLOR01",
}
CIA = {
    0xBFE001: "CIAA_PRA (fire buttons, /RDY, /TK0, /WPRO, /CHNG)",
    0xBFD100: "CIAB_PRB (floppy: /STEP /DIR /SIDE /SEL /MTR)",
    0xBFE201: "CIAA_DDRA", 0xBFEC01: "CIAA_SDR (keyboard)",
    0xBFED01: "CIAA_ICR", 0xBFDD00: "CIAB_ICR",
}


def note(op_str):
    notes = []
    for m in re.finditer(r"\$([0-9a-f]+)", op_str):
        v = int(m.group(1), 16)
        if 0xDFF000 <= v <= 0xDFF1FE:
            notes.append(CUSTOM.get(v - 0xDFF000, "custom+$%03X" % (v - 0xDFF000)))
        elif v in CIA:
            notes.append(CIA[v])
    m = re.search(r"\$([0-9a-f]+)\(a([0-6])\)", op_str)
    if m and not notes:
        off = int(m.group(1), 16)
        if off in CUSTOM:
            notes.append("if a%s=$DFF000: %s" % (m.group(2), CUSTOM[off]))
    return "; " + ", ".join(notes) if notes else ""


def main():
    path, start, length, base = sys.argv[1], *(int(x, 0) for x in sys.argv[2:5])
    data = open(path, "rb").read()[start:start + length]
    md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_M68K_000)
    pc = 0
    while pc < len(data):
        got = False
        for ins in md.disasm(data[pc:], base + pc):
            raw = ins.bytes.hex()
            print("%06X  %-20s %-8s %-34s %s" % (
                ins.address, raw, ins.mnemonic, ins.op_str, note(ins.op_str)))
            pc += ins.size
            got = True
        if pc < len(data):
            # undecodable word: emit as data and resync
            w = data[pc:pc + 2]
            print("%06X  %-20s dc.w     $%s" % (base + pc, w.hex(), w.hex()))
            pc += 2
        elif not got:
            break


if __name__ == "__main__":
    main()
