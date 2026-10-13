// Preloaded into a cc-cost process under test: stdin and stdout pose as a terminal, so the wizard draws its
// menus and reads keys from the pipe the test writes to.
process.stdin.isTTY = true;
process.stdout.isTTY = true;
process.stdout.columns = 120;
process.stdin.setRawMode = function () { return this; };
