import hashlib
import io
import unittest
from unittest.mock import Mock

import tencent_cos_probe as probe


class CosProbeTests(unittest.TestCase):
    def test_hashes_stream_without_saving_body(self):
        data = b"sample bytes"
        body = io.BytesIO(data)
        sdk_body = Mock(get_raw_stream=Mock(return_value=body))
        client = Mock()
        client.get_object.return_value = {"Body": sdk_body}
        size, digest = probe.probe(client, "bucket")
        self.assertEqual(size, len(data))
        self.assertEqual(digest, hashlib.sha256(data).hexdigest())
        client.get_object.assert_called_once_with(Bucket="bucket", Key=probe.OBJECT_KEY)

    def test_rejects_oversized_object_and_closes_body(self):
        class Body:
            def __init__(self):
                self.remaining = probe.MAX_OBJECT_BYTES + 1
                self.closed = False

            def read(self, amount):
                count = min(amount, self.remaining)
                self.remaining -= count
                return b"x" * count

            def close(self):
                self.closed = True

        body = Body()
        client = Mock()
        client.get_object.return_value = {"Body": Mock(get_raw_stream=Mock(return_value=body))}
        with self.assertRaisesRegex(probe.ProbeError, "OBJECT_TOO_LARGE"):
            probe.probe(client, "bucket")
        self.assertTrue(body.closed)


if __name__ == "__main__":
    unittest.main()
