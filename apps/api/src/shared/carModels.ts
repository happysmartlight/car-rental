// Hãng & dòng xe phổ biến ở Việt Nam — gợi ý khi thêm xe (vẫn nhập tay được "Khác").

export interface CarMake {
  name: string;
  models: string[];
  /** Dòng xe chạy điện — chọn thì tự đặt nhiên liệu "Điện". */
  electric?: string[];
}

export const CAR_MAKES: CarMake[] = [
  {
    name: 'VinFast',
    models: ['VF 3', 'VF 5', 'VF 6', 'VF 7', 'VF 8', 'VF 9', 'VF e34', 'Limo Green', 'Herio Green', 'Nerio Green', 'Minio Green', 'Fadil', 'Lux A2.0', 'Lux SA2.0', 'President'],
    electric: ['VF 3', 'VF 5', 'VF 6', 'VF 7', 'VF 8', 'VF 9', 'VF e34', 'Limo Green', 'Herio Green', 'Nerio Green', 'Minio Green'],
  },
  { name: 'Toyota', models: ['Vios', 'Wigo', 'Raize', 'Yaris Cross', 'Corolla Cross', 'Corolla Altis', 'Veloz Cross', 'Avanza Premio', 'Innova', 'Innova Cross', 'Fortuner', 'Camry', 'Hilux', 'Land Cruiser Prado', 'Alphard'] },
  { name: 'Hyundai', models: ['Grand i10', 'Accent', 'Elantra', 'Venue', 'Creta', 'Stargazer', 'Tucson', 'Santa Fe', 'Custin', 'Palisade', 'Ioniq 5'], electric: ['Ioniq 5'] },
  { name: 'Kia', models: ['Morning', 'Soluto', 'K3', 'K5', 'Sonet', 'Seltos', 'Carens', 'Sportage', 'Sorento', 'Carnival'] },
  { name: 'Mitsubishi', models: ['Attrage', 'Xpander', 'Xpander Cross', 'Xforce', 'Outlander', 'Pajero Sport', 'Triton', 'Destinator'] },
  { name: 'Honda', models: ['Brio', 'City', 'Civic', 'HR-V', 'BR-V', 'CR-V', 'Accord'] },
  { name: 'Mazda', models: ['Mazda2', 'Mazda3', 'Mazda6', 'CX-3', 'CX-30', 'CX-5', 'CX-8', 'BT-50'] },
  { name: 'Ford', models: ['Ranger', 'Everest', 'Territory', 'Transit', 'Explorer'] },
  { name: 'Suzuki', models: ['Swift', 'Ertiga', 'XL7', 'Ciaz', 'Jimny'] },
  { name: 'Nissan', models: ['Almera', 'Kicks', 'Navara'] },
  { name: 'MG', models: ['MG5', 'ZS', 'HS', 'MG4'], electric: ['MG4'] },
  { name: 'Peugeot', models: ['2008', '3008', '5008'] },
  { name: 'BYD', models: ['Dolphin', 'Atto 3', 'Seal', 'Sealion 6', 'M6'], electric: ['Dolphin', 'Atto 3', 'Seal', 'M6'] },
  { name: 'Wuling', models: ['Mini EV', 'Bingo'], electric: ['Mini EV', 'Bingo'] },
  { name: 'Chevrolet', models: ['Spark', 'Aveo', 'Cruze', 'Colorado', 'Trailblazer'] },
  { name: 'Mercedes-Benz', models: ['C-Class', 'E-Class', 'GLC'] },
];

/** So khớp không phân biệt hoa thường, khoảng trắng, gạch ngang ("Vinfast" = "VinFast", "VF3" = "VF 3"). */
const key = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[\s\-_.]/g, '');

export function findCarMake(name: string | null | undefined): CarMake | undefined {
  const k = key(name);
  return k ? CAR_MAKES.find((m) => key(m.name) === k) : undefined;
}

export function findCarModel(make: CarMake | undefined, name: string | null | undefined): string | undefined {
  const k = key(name);
  return make && k ? make.models.find((m) => key(m) === k) : undefined;
}
