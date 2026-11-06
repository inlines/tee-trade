"""Read-only integration checks against a running Docker Compose stack."""
import json
import os
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

BASE_URL = os.environ.get('BASE_URL', 'http://localhost:4200').rstrip('/')


def get(path):
    return urlopen(BASE_URL + path, timeout=10)


def get_json(path):
    with get(path) as response:
        return json.load(response)


class CatalogSmokeTest(unittest.TestCase):
    def test_categories_partition_catalog(self):
        all_products = get_json('/api/products')
        categorized = []
        for category in ('sneakers', 't-shirts', 'accessories', 'headwear'):
            products = get_json('/api/products?category=' + category)
            self.assertTrue(all(product['category'] == category for product in products))
            categorized.extend(product['id'] for product in products)
        self.assertCountEqual(categorized, [product['id'] for product in all_products if product['category']])

    def test_product_details_and_images(self):
        products = get_json('/api/products')
        for product in products:
            with self.subTest(product=product['id']):
                detail = get_json('/api/products/' + str(product['id']))
                self.assertEqual(product, detail)
                for field in ('name', 'description', 'theme'):
                    self.assertIsInstance(detail[field], str)
                self.assertIsInstance(detail['size'], str)
                self.assertIsInstance(detail['brands'], list)
                self.assertTrue(all(isinstance(b,str) for b in detail['brands']))
                if detail['price_cents'] is not None:
                    self.assertGreaterEqual(detail['price_cents'], 0)
                self.assertLessEqual(len(detail['images']), 12)
                for image in detail['images']:
                    self.assertIsInstance(image['alt'], str)
                    if image['url'].startswith('/'):
                        with get(image['url']) as response:
                            self.assertTrue(response.headers['Content-Type'].startswith('image/'))

    def test_errors(self):
        for path, expected in [('/api/products/2147483647', 404), ('/api/products?category=invalid', 400)]:
            with self.subTest(path=path):
                with self.assertRaises(HTTPError) as error:
                    get_json(path)
                self.assertEqual(error.exception.code, expected)
                error.exception.close()

    def test_direct_navigation_serves_angular(self):
        for path in ('/', '/catalog', '/catalog/sneakers', '/catalog/t-shirts', '/catalog/accessories', '/catalog/headwear', '/about', '/product/1'):
            with self.subTest(path=path), get(path) as response:
                self.assertIn('<app-root>', response.read().decode())


if __name__ == '__main__':
    unittest.main(verbosity=2)
