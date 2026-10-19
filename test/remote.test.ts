import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRemote, remoteParts, remoteProblem, shQuote, sshFailure } from '../src/remote.ts';

test('remote: scp syntax, path relative to the remote home', () => {
    assert.deepEqual(parseRemote('pi@raspberrypi.local:cc-cost'), { host: 'pi@raspberrypi.local', dir: 'cc-cost' });
    assert.deepEqual(parseRemote('pi@pi:~/data/cc-cost/'), { host: 'pi@pi', dir: 'data/cc-cost' });
    assert.deepEqual(parseRemote('pi@pi:/srv/cc-cost'), { host: 'pi@pi', dir: '/srv/cc-cost' });
    assert.deepEqual(parseRemote('server:'), { host: 'server', dir: '.' });
    assert.equal(parseRemote('pi@host'), undefined, 'a local path or a bare host is not a remote');
    assert.equal(parseRemote('demo-pi:127.0.0.1:2222:cc-cost'), undefined, 'a port typed into the folder');
});

test('remote: ssh:// and scp:// URLs carry a port', () => {
    assert.deepEqual(parseRemote('ssh://pi@raspberrypi.local:2222/cc-cost'), { host: 'pi@raspberrypi.local', port: 2222, dir: 'cc-cost' });
    assert.deepEqual(parseRemote('scp://pi@192.168.1.5:2222/cc-cost/'), { host: 'pi@192.168.1.5', port: 2222, dir: 'cc-cost' });
    assert.deepEqual(parseRemote('ssh://pi@host/cc-cost'), { host: 'pi@host', port: undefined, dir: 'cc-cost' });
    assert.deepEqual(parseRemote('ssh://pi@host:2222//srv/cc-cost'), { host: 'pi@host', port: 2222, dir: '/srv/cc-cost' }, '// starts an absolute path');
    assert.deepEqual(parseRemote('ssh://pi@host:2222'), { host: 'pi@host', port: 2222, dir: '.' });
    assert.deepEqual(parseRemote('ssh://pi@[::1]:2222/cc-cost'), { host: 'pi@[::1]', port: 2222, dir: 'cc-cost' });
    assert.equal(parseRemote('ssh://pi@host:99999/cc-cost'), undefined, 'port out of range');
    assert.equal(parseRemote('http://host/cc-cost'), undefined);
});

test('remote: why an address was refused', () => {
    assert.equal(remoteProblem('demo-pi:127.0.0.1:2222:cc-cost'), 'port');
    assert.equal(remoteProblem('pi@host'), 'form');
    assert.equal(remoteProblem('ssh://pi@host:abc/cc-cost'), 'form', 'a broken URL is not a port in the scp form');
    assert.equal(remoteProblem('pi@host:cc-cost'), undefined);
    assert.equal(remoteProblem('ssh://pi@host:2222/cc-cost'), undefined);
});

test('remote: ssh failures told apart, and the parts a hint names', () => {
    assert.equal(sshFailure('demo-pi@127.0.0.1: Permission denied (publickey,keyboard-interactive).'), 'auth');
    assert.equal(sshFailure('ssh: connect to host 127.0.0.1 port 2222: Connection refused'), 'refused');
    assert.equal(sshFailure('Connection closed by 127.0.0.1 port 2222'), 'refused', 'a port that answers but speaks no SSH');
    assert.equal(sshFailure('ssh: Could not resolve hostname nope: Name or service not known'), 'resolve');
    assert.equal(sshFailure('@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@'), 'hostkey');
    assert.equal(sshFailure('ssh: connect to host 10.0.0.9 port 22: Connection timed out'), 'timeout');
    assert.equal(sshFailure('something else'), undefined);
    assert.deepEqual(remoteParts('ssh://demo-pi@127.0.0.1:2222/cc-cost'), { user: 'demo-pi', known: '[127.0.0.1]:2222' });
    assert.deepEqual(remoteParts('pi@raspberrypi.local:cc-cost'), { user: 'pi', known: 'raspberrypi.local' });
    assert.deepEqual(remoteParts('demo-pi:cc-cost'), { user: undefined, known: 'demo-pi' });
});

test('remote: paths are quoted for the remote shell', () => {
    assert.equal(shQuote("it's"), String.raw`'it'\''s'`);
});
